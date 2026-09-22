import express from "express";
import { timingSafeEqual } from "node:crypto";
import { ApiError, type GlacierProvider, type Query, type Resource } from "./provider-core.js";
import { addDays, isDay, normaliseMobiles, todayHk } from "./mapping.js";

function send(response: express.Response, status: number, body: unknown): void {
  response.status(status).json(body);
}
function authenticate(request: express.Request, expected: Buffer): boolean {
  const actual = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const ALLOWED: Record<Resource | 'automation-context' | 'customer-context', string[]> = {
  students: ['limit', 'cursor', 'studentId', 'mobile'],
  packages: ['limit', 'cursor', 'studentId', 'activeOnly', 'expiringWithinDays', 'maxRemaining'],
  'tuition-payments': ['limit', 'cursor', 'studentId', 'since'],
  lessons: ['limit', 'cursor', 'studentId', 'date', 'from', 'to', 'status', 'includeCancelled'],
  'automation-context': ['from', 'to', 'asOf'],
  'customer-context': ['mobile', 'studentId'],
};
const invalid = (code: string, message: string) => new ApiError(400, code, message);
function values(url: URL, resource: keyof typeof ALLOWED): Record<string, string> {
  const allowed = new Set(ALLOWED[resource]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw invalid('INVALID_QUERY', 'Unknown or repeated query parameter.');
  const out: Record<string, string> = {};
  for (const [key, input] of url.searchParams) { if (!input || input.length > (key === 'cursor' ? 2048 : 100)) throw invalid('INVALID_QUERY', 'Invalid query value.'); out[key] = input; }
  return out;
}
export function studentId(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(input)) throw invalid('INVALID_STUDENT', 'Invalid student identifier.');
  return input;
}
export function mobile(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const normalised = normaliseMobiles(input)[0];
  if (!normalised) throw invalid('INVALID_MOBILE', 'Mobile must be an 8-digit Hong Kong number or an international number.');
  return normalised;
}
function instant(input: string, code: string): string {
  if (!/(Z|[+-]\d\d:\d\d)$/.test(input) || !Number.isFinite(Date.parse(input))) throw invalid(code, 'Supply an ISO timestamp with an offset.');
  return new Date(input).toISOString();
}
function flag(input: string | undefined, name: string): boolean | undefined {
  if (input === undefined) return undefined;
  if (input !== 'true' && input !== 'false') throw invalid('INVALID_QUERY', `${name} must be true or false.`);
  return input === 'true';
}
function integer(input: string | undefined, name: string, max: number): number | undefined {
  if (input === undefined) return undefined;
  if (!/^\d{1,6}$/.test(input) || Number(input) > max) throw invalid('INVALID_QUERY', `${name} must be an integer between 0 and ${max}.`);
  return Number(input);
}
/** Validates a page query for one resource; dates are `yyyy-mm-dd` in the source zone. */
export function parseQuery(url: URL, resource: Resource, now = new Date()): Query {
  const v = values(url, resource);
  const limitText = v.limit ?? '100';
  if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 500) throw invalid('INVALID_LIMIT', 'Limit must be between 1 and 500.');
  const query: Query = { limit: Number(limitText), cursor: v.cursor, studentId: studentId(v.studentId) };
  if (resource === 'students') query.mobile = mobile(v.mobile);
  if (resource === 'packages') { query.activeOnly = flag(v.activeOnly, 'activeOnly'); query.expiringWithinDays = integer(v.expiringWithinDays, 'expiringWithinDays', 3650); query.maxRemaining = integer(v.maxRemaining, 'maxRemaining', 100000); }
  if (resource === 'tuition-payments') {
    if (v.since !== undefined) query.since = instant(v.since, 'INVALID_SINCE');
    else if (!query.studentId) throw invalid('INVALID_SINCE', 'Supply since (ISO timestamp with offset) or studentId.');
  }
  if (resource === 'lessons') {
    if (v.date !== undefined) { if (v.from !== undefined || v.to !== undefined || !isDay(v.date)) throw invalid('INVALID_WINDOW', 'Supply either date=yyyy-mm-dd or from/to.'); query.date = v.date; }
    else {
      const from = v.from ?? todayHk(now);
      if (!isDay(from)) throw invalid('INVALID_WINDOW', 'from must be a yyyy-mm-dd date.');
      const to = v.to ?? addDays(from, 30);
      if (!isDay(to) || to < from || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) > 30 * 86_400_000) throw invalid('INVALID_WINDOW', 'from/to must be yyyy-mm-dd dates spanning at most 31 days.');
      query.from = from; query.to = to;
    }
    if (v.status !== undefined) { if (v.status !== 'scheduled') throw invalid('INVALID_QUERY', 'status must be scheduled.'); query.status = 'scheduled'; }
    query.includeCancelled = flag(v.includeCancelled, 'includeCancelled');
  }
  return query;
}
/** Version-1 context window: ISO instants with offsets, at most 31 days, converted to source-zone days. */
export function parseContextQuery(url: URL, now = new Date()): Query {
  const v = values(url, 'automation-context');
  const query: Query = { limit: 100 };
  if (v.asOf !== undefined) { query.asOf = instant(v.asOf, 'INVALID_AS_OF'); now = new Date(query.asOf); }
  const from = v.from !== undefined ? instant(v.from, 'INVALID_WINDOW') : now.toISOString();
  const to = v.to !== undefined ? instant(v.to, 'INVALID_WINDOW') : new Date(Date.parse(from) + 31 * 86_400_000).toISOString();
  if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 31 * 86_400_000) throw invalid('INVALID_WINDOW', 'Supply ISO timestamps with offsets and a window of at most 31 days.');
  query.from = todayHk(new Date(from)); query.to = todayHk(new Date(Date.parse(to) - 1));
  return query;
}

/**
 * The Glacier read contract as an Express router, mountable under a path prefix (the Pi mounts it at
 * /glacier). Same routes, validation, bearer authentication and error envelope as the reference
 * adapter's node:http server; booking (write) routes are not part of this read-only snapshot.
 */
export function createGlacierRouter(provider: GlacierProvider, apiKey: string): express.Router {
  if (apiKey.length < 32) throw new Error('The glacier API key must contain at least 32 characters.');
  const expected = Buffer.from(apiKey);
  const router = express.Router();
  router.get('/health', async (_req, res) => {
    let available = false;
    try { available = await provider.health(); } catch { /* Health never releases source details. */ }
    send(res, available ? 200 : 503, { status: available ? 'ok' : 'unavailable', source: available ? 'available' : 'unavailable' });
  });
  router.use((req, res, next) => {
    if (!authenticate(req, expected)) return send(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'A valid bearer token is required.' } });
    if (req.method !== 'GET') return send(res, 405, { error: { code: 'READ_ONLY', message: 'This API supports read operations only.' } });
    next();
  });
  const handle = (fn: (req: express.Request, res: express.Response) => Promise<void>) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    fn(req, res).catch(next);
  };
  router.get('/v1/:resource(students|packages|tuition-payments|lessons)', handle(async (req, res) => {
    const resource = req.params.resource as Resource;
    const url = new URL(req.originalUrl, 'http://localhost');
    send(res, 200, await provider.page(resource, parseQuery(url, resource)));
  }));
  router.get('/v1/customer-context', handle(async (req, res) => {
    const url = new URL(req.originalUrl, 'http://localhost');
    const v = values(url, 'customer-context');
    const number = mobile(v.mobile);
    if (!number) throw invalid('INVALID_MOBILE', 'mobile is required.');
    send(res, 200, await provider.customerContext(number, studentId(v.studentId)));
  }));
  router.get('/v1/students/:id/automation-context', handle(async (req, res) => {
    let id: string;
    try { id = decodeURIComponent(req.params.id); } catch { throw invalid('INVALID_STUDENT', 'Invalid student identifier.'); }
    const url = new URL(req.originalUrl, 'http://localhost');
    const context = await provider.context(studentId(id)!, parseContextQuery(url));
    if (!context) throw new ApiError(404, 'STUDENT_NOT_FOUND', 'Student was not found.');
    send(res, 200, context);
  }));
  router.use((_req, res) => send(res, 404, { error: { code: 'NOT_FOUND', message: 'Operation was not found.' } }));
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ApiError) return send(res, error.status, { error: { code: error.code, message: error.message } });
    send(res, 503, { error: { code: 'SOURCE_UNAVAILABLE', message: 'Source data could not be read. Retry later.' } });
    // Deliberately do not log database exceptions, credentials, identifiers or rows.
  });
  return router;
}
