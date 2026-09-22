import type { GlacierContext, GlacierCustomerContext, GlacierLessonRow, GlacierPackageRow, GlacierPage, GlacierPaymentRow, GlacierSource, GlacierStudentRow } from './contract.js';
import { addDays, legacyLesson, legacyPackage, legacyPayment, legacyStudent, todayHk } from './mapping.js';

export type Resource = 'students' | 'packages' | 'tuition-payments' | 'lessons';
export type ResourceItem = GlacierStudentRow | GlacierPackageRow | GlacierPaymentRow | GlacierLessonRow;
/** Validated read query. Dates are `yyyy-mm-dd` in the source zone; `since` is an ISO instant; `mobile` is E.164. */
export interface Query {
  limit: number;
  cursor?: string;
  studentId?: string;
  mobile?: string;
  /** lessons: one day, or an inclusive day range of at most 31 days. */
  date?: string;
  from?: string;
  to?: string;
  status?: 'scheduled';
  includeCancelled?: boolean;
  /** packages */
  activeOnly?: boolean;
  expiringWithinDays?: number;
  maxRemaining?: number;
  /** tuition-payments */
  since?: string;
  /** legacy automation-context evaluation instant */
  asOf?: string;
}
export interface GlacierProvider {
  /** Read-only source availability; not a statement about business-data freshness. */
  health(): Promise<boolean>;
  page(resource: Resource, query: Query): Promise<GlacierPage<ResourceItem>>;
  /** Version-1 per-student context. */
  context(studentId: string, query: Query): Promise<GlacierContext | null>;
  /** Every student on a mobile with their active packages, upcoming lessons and recent payments. */
  customerContext(mobile: string, studentId: string | undefined, now?: Date): Promise<GlacierCustomerContext>;
  close(): Promise<void>;
}
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const RESPONSE_LIMIT = 60_000;
/** Broker projection is limited to 100 array items and 64 KB; never expose partial context. */
export function boundedContext<T extends GlacierContext | GlacierCustomerContext>(context: T): T {
  const arrays = 'students' in context ? context.students.flatMap(s => [s.packages, s.payments, s.lessons]) : [context.packages, context.payments, context.lessons];
  if (arrays.some(items => items.length > 100) || context.issues.length > 100 || Buffer.byteLength(JSON.stringify(context), 'utf8') > RESPONSE_LIMIT) {
    throw new ApiError(422, 'CONTEXT_TOO_LARGE', 'Complete context exceeds the broker limit; use bounded paginated operations.');
  }
  return context;
}
export function cursorScope(resource: Resource, query: Query): string {
  return JSON.stringify([resource, query.studentId ?? '', query.mobile ?? '', query.date ?? '', query.from ?? '', query.to ?? '', query.status ?? '', query.includeCancelled ?? false,
    query.activeOnly ?? false, query.expiringWithinDays ?? null, query.maxRemaining ?? null, query.since ?? '', query.asOf ?? '']);
}
export function decodeCursor(cursor: string | undefined, scope: string): string {
  if (!cursor) return '';
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (!Array.isArray(value) || value.length !== 2 || value[0] !== scope || typeof value[1] !== 'string' || value[1].length > 200) throw new Error();
    return value[1];
  } catch { throw new ApiError(400, 'INVALID_CURSOR', 'Cursor does not match this query.'); }
}
export function encodeCursor(scope: string, id: string): string {
  return Buffer.from(JSON.stringify([scope, id])).toString('base64url');
}
export const itemId = (item: ResourceItem): string => 'lessonId' in item ? item.lessonId : 'packageId' in item && 'remaining' in item ? item.packageId : 'paymentId' in item ? item.paymentId : item.studentId;

/** Shared by every provider: every student on the mobile, then bounded per-student reads. */
export async function customerContextFrom(provider: Pick<GlacierProvider, 'page'>, mobile: string, studentId: string | undefined, now: Date, source: GlacierSource): Promise<GlacierCustomerContext> {
  const found = await provider.page('students', { limit: 21, mobile });
  let students = found.items as GlacierStudentRow[];
  if (students.length > 20) throw new ApiError(422, 'CONTEXT_TOO_LARGE', 'Too many students share this mobile for a bounded context.');
  if (studentId !== undefined) { students = students.filter(s => s.studentId === studentId); if (!students.length) throw new ApiError(404, 'STUDENT_NOT_FOUND', 'The student is not on this mobile.'); }
  const today = todayHk(now), since = new Date(now.valueOf() - 90 * 86_400_000).toISOString();
  const issues = [...found.issues];
  const entries = await Promise.all(students.map(async student => {
    const base = { limit: 101, studentId: student.studentId };
    const [packages, lessons, payments] = await Promise.all([provider.page('packages', { ...base, activeOnly: true }), provider.page('lessons', { ...base, from: today, to: addDays(today, 30), status: 'scheduled' }), provider.page('tuition-payments', { ...base, since })]);
    if ([packages, lessons, payments].some(page => page.items.length > 100)) throw new ApiError(422, 'CONTEXT_TOO_LARGE', 'Student context exceeds the bounded response.');
    issues.push(...packages.issues, ...lessons.issues, ...payments.issues);
    return { student, packages: packages.items as GlacierPackageRow[], lessons: lessons.items as GlacierLessonRow[], payments: payments.items as GlacierPaymentRow[] };
  }));
  return boundedContext({ mobile, students: entries, source, issues });
}

/** Version-1 per-student context, shared by every provider. */
export async function contextFrom(provider: Pick<GlacierProvider, 'page'>, studentId: string, query: Query, source: GlacierSource): Promise<GlacierContext | null> {
  const base = { limit: 101, studentId };
  const from = query.from ?? todayHk(query.asOf ? new Date(query.asOf) : new Date());
  const [students, packages, payments, lessons] = await Promise.all([
    provider.page('students', base), provider.page('packages', base), provider.page('tuition-payments', base), provider.page('lessons', { ...base, from, to: query.to ?? addDays(from, 30) })]);
  if (!students.items.length) return null;
  if ([students, packages, payments, lessons].some(page => page.items.length > 100)) throw new ApiError(422, 'CONTEXT_TOO_LARGE', 'Student context exceeds the bounded response; use paginated operations.');
  const issues = [...students.issues, ...packages.issues, ...payments.issues, ...lessons.issues];
  return boundedContext({ student: legacyStudent(students.items[0] as GlacierStudentRow, issues), packages: (packages.items as GlacierPackageRow[]).map(legacyPackage),
    payments: (payments.items as GlacierPaymentRow[]).map(legacyPayment), lessons: (lessons.items as GlacierLessonRow[]).map(legacyLesson), source, issues });
}
