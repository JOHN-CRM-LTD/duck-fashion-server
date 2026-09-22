import { DatabaseSync } from 'node:sqlite';
import type { GlacierContext, GlacierCustomerContext, GlacierIssue, GlacierPage, GlacierSource, ResourceItem } from './contract.js';
import { ApiError, contextFrom, customerContextFrom, cursorScope, decodeCursor, encodeCursor, type GlacierProvider, type Query, type Resource } from './provider-core.js';
import { addDays, lessonRow, mobileVariants, onMobile, packageRow, paymentRow, studentRow, HK_OFFSET_MS, type Row } from './mapping.js';

/**
 * SQLite port of the Glacier read contract. The database is a static snapshot seeded from the IceRink
 * SQL Server backup (see server/glacier-seed.ts); queries keep the native Booking app's predicates
 * (src/sql.ts in johncrm/glacier-api is the reference implementation).
 *
 * Datetimes are stored as HK wall-clock text `YYYY-MM-DDTHH:MM:SS.mmm` (lexicographic order equals
 * chronological order) and hydrated into Dates whose UTC components equal the wall clock — the same
 * convention the mssql pool's useUTC mode gives the reference adapter, so the shared row mappers
 * (mapping.ts) work unchanged.
 */
const IDENTITY = 'm.mbr_name,m.mbr_mobile,m.parent_name1,m.parent_phone1,m.parent_name2,m.parent_phone2';

/** Inner selects mirror src/sql.ts; every statement ends in WHERE so the pagination wrapper can extend it. */
const LESSON_BASE = `SELECT RTRIM(sh.bk_no)||':'||COALESCE(RTRIM(sh.mbr_code),'') AS _id,RTRIM(sh.bk_no) AS bk_no,RTRIM(sh.mbr_code) AS mbr_code,RTRIM(sh.course_no) AS course_no,sh.showup_status,
 b.bk_status,b.bk_date,b.start_time,b.end_time,cs.status AS student_status,c.course_status,c.course_desc,c.rink_area,lt.lesson_desc,${IDENTITY}
 FROM course_showup sh JOIN book_info b ON b.bk_no=sh.bk_no AND b.course_no=sh.course_no JOIN course c ON c.course_no=sh.course_no
 JOIN course_student cs ON cs.course_no=sh.course_no AND cs.mbr_code=sh.mbr_code JOIN member_info m ON m.mbr_code=sh.mbr_code LEFT JOIN lesson_type lt ON lt.lesson_type=c.lesson_type`;
const PACKAGE_BASE = `SELECT RTRIM(cs.course_no)||':'||COALESCE(RTRIM(cs.mbr_code),'') AS _id,RTRIM(cs.course_no) AS course_no,RTRIM(cs.mbr_code) AS mbr_code,cs.status,cs.tot_lesson,cs.con_lesson,cs.bal_lesson,RTRIM(cs.trx_no) AS trx_no,
 c.course_status,c.course_desc,c.expire_date,${IDENTITY}
 FROM course_student cs JOIN course c ON c.course_no=cs.course_no JOIN member_info m ON m.mbr_code=cs.mbr_code`;
const PAYMENT_BASE = `SELECT RTRIM(h.trx_no) AS _id,RTRIM(h.mbr_code) AS mbr_code,RTRIM(h.course_no) AS course_no,h.course_name,h.trx_type,h.trx_status,h.trx_date,h.updated_on,h.total_amt,h.recv_amt,h.chg_amt,${IDENTITY}
 FROM trx_hdr_bk h LEFT JOIN member_info m ON m.mbr_code=h.mbr_code`;
const STUDENT_BASE = `SELECT RTRIM(m.mbr_code) AS _id,m.mbr_status,${IDENTITY} FROM member_info m`;

/** Per-page derived counters, computed only for the rows the page returns (the Pi is a small machine). */
const PACKAGE_COUNTERS = `,
 (SELECT COUNT(*) FROM course_showup s JOIN book_info b ON b.bk_no=s.bk_no WHERE s.course_no=p.course_no AND s.mbr_code=p.mbr_code AND s.showup_status='*' AND b.bk_status NOT IN ('C','D')) AS pending,
 (SELECT COUNT(*) FROM course_showup s JOIN book_info b ON b.bk_no=s.bk_no WHERE s.course_no=p.course_no AND s.mbr_code=p.mbr_code AND s.showup_status NOT IN ('*','C') AND b.bk_status='S') AS attended_unposted,
 (SELECT COUNT(*) FROM course_showup s JOIN book_info b ON b.bk_no=s.bk_no WHERE s.course_no=p.course_no AND s.mbr_code=p.mbr_code AND s.showup_status NOT IN ('*','C') AND b.bk_status='D') AS posted_seats,
 (SELECT COUNT(*) FROM course_showup s WHERE s.course_no=p.course_no AND s.mbr_code=p.mbr_code AND s.showup_status<>'C') AS live_seats`;
const PAYMENT_COUNTERS = `,
 (SELECT SUM(p.pay_bas_amt) FROM trx_payment_bk p WHERE p.trx_no=t._id) AS tender_total,
 (SELECT CASE WHEN COUNT(DISTINCT p.curr_code)=1 THEN MAX(RTRIM(p.curr_code)) ELSE NULL END FROM trx_payment_bk p WHERE p.trx_no=t._id) AS currency`;
const STUDENT_COUNTERS = `,
 (SELECT COUNT(*) FROM course_student cs JOIN course c ON c.course_no=cs.course_no WHERE cs.mbr_code=m2._id AND cs.status<>'C' AND c.course_status NOT IN ('C','T')) AS active_enrolments`;

const DATETIME_COLUMNS = new Set(['bk_date', 'start_time', 'end_time', 'coach_start', 'coach_end', 'expire_date', 'trx_date', 'updated_on']);
/** Stored wall-clock text -> Date with UTC components equal to the wall clock (mssql useUTC convention). */
function hydrate(row: Row): Row {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (typeof value === 'string' && DATETIME_COLUMNS.has(key) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) row[key] = new Date(`${value}Z`);
  }
  return row;
}
/** Text form of an instant's HK wall clock (the mssql adapter's wallParameter). */
function wallText(instant: string | Date): string {
  return new Date(new Date(instant).valueOf() + HK_OFFSET_MS).toISOString().slice(0, 23);
}
const dayText = (day: string): string => `${day}T00:00:00.000`;

export class SqliteGlacierProvider implements GlacierProvider {
  private constructor(private db: DatabaseSync, private dataAsOf: string) {}
  static open(path: string): SqliteGlacierProvider {
    const db = new DatabaseSync(path, { readOnly: true });
    const meta = db.prepare('SELECT value FROM _glacier_meta WHERE key=?').get('dataAsOf') as { value: string } | undefined;
    if (!meta) { db.close(); throw new Error('Not a glacier snapshot database (missing _glacier_meta).'); }
    return new SqliteGlacierProvider(db, meta.value);
  }
  async health(): Promise<boolean> {
    try { return this.db.prepare('SELECT 1 AS available').get()?.available === 1; } catch { return false; }
  }
  async source(): Promise<GlacierSource> {
    // The stored snapshot stamp is HK wall clock; the contract carries an ISO instant (sqlTime).
    const asOf = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(this.dataAsOf)
      ? new Date(new Date(`${this.dataAsOf}Z`).valueOf() - HK_OFFSET_MS).toISOString()
      : new Date(0).toISOString();
    return { mode: 'sql', observedAt: new Date().toISOString(), dataAsOf: asOf, timeZone: 'Asia/Hong_Kong' };
  }
  /** Builds the per-resource SELECT with its native predicates; `args` collects the positional binds. */
  static statement(resource: Resource, query: Query, args: unknown[], now = new Date()): string {
    const where: string[] = [];
    const studentId = query.studentId ?? null;
    if (resource === 'lessons') {
      if (query.date) { args.push(dayText(query.date)); where.push('b.bk_date=?'); }
      else { args.push(dayText(query.from!)); args.push(dayText(addDays(query.to!, 1))); where.push('b.bk_date>=? AND b.bk_date<?'); }
      where.push(query.includeCancelled ? `b.bk_status<>'D'` : `b.bk_status NOT IN ('C','D') AND c.course_status<>'C' AND cs.status<>'C'`);
      if (query.status === 'scheduled') where.push(`sh.showup_status='*'`);
      args.push(studentId, studentId); where.push('(? IS NULL OR sh.mbr_code=?)');
      return `${LESSON_BASE} WHERE ${where.join(' AND ')}`;
    }
    if (resource === 'packages') {
      args.push(studentId, studentId); where.push('(? IS NULL OR cs.mbr_code=?)');
      if (query.activeOnly) where.push(`cs.status<>'C' AND c.course_status NOT IN ('C','T')`);
      if (query.expiringWithinDays !== undefined) { args.push(wallText(now), wallText(new Date(now.valueOf() + query.expiringWithinDays * 86_400_000))); where.push('c.expire_date>=? AND c.expire_date<?'); }
      if (query.maxRemaining !== undefined) { args.push(query.maxRemaining); where.push('cs.bal_lesson<=?'); }
      return `${PACKAGE_BASE} WHERE ${where.join(' AND ')}`;
    }
    if (resource === 'tuition-payments') {
      const since = query.since ? wallText(query.since) : null;
      args.push(since, since, since);
      args.push(studentId, studentId);
      return `${PAYMENT_BASE} WHERE h.parent_type='SAL' AND h.trx_type='SA5' AND (? IS NULL OR h.updated_on>=? OR h.trx_date>=?) AND (? IS NULL OR h.mbr_code=?)`;
    }
    args.push(studentId, studentId); where.push('(? IS NULL OR m.mbr_code=?)');
    if (query.mobile) {
      const variants = mobileVariants(query.mobile);
      args.push(...variants.exact, variants.prefix, variants.infix);
      where.push(`(m.mbr_mobile IN (${variants.exact.map(() => '?').join(',')}) OR m.mbr_mobile LIKE ? OR m.mbr_mobile LIKE ?)`);
    }
    return `${STUDENT_BASE} WHERE ${where.join(' AND ')}`;
  }
  /** Page of raw rows: keyset pagination over `_id`, then the derived counters for the returned rows only. */
  private rawPage(resource: Resource, query: Query): Row[] {
    const after = decodeCursor(query.cursor, cursorScope(resource, query));
    const args: unknown[] = [];
    const select = SqliteGlacierProvider.statement(resource, query, args);
    args.push(after, query.limit + 1);
    const paged = `SELECT * FROM (${select}) WHERE _id>? ORDER BY _id LIMIT ?`;
    if (resource === 'packages') {
      return this.db.prepare(`SELECT p.*${PACKAGE_COUNTERS} FROM (${paged}) p`).all(...args).map(row => hydrate(row as Row));
    }
    if (resource === 'tuition-payments') {
      return this.db.prepare(`SELECT t.*${PAYMENT_COUNTERS} FROM (${paged}) t`).all(...args).map(row => hydrate(row as Row));
    }
    if (resource === 'students') {
      return this.db.prepare(`SELECT m2.*${STUDENT_COUNTERS} FROM (${paged}) m2`).all(...args).map(row => hydrate(row as Row));
    }
    const rows = this.db.prepare(paged).all(...args).map(row => hydrate(row as Row));
    return this.attachCoaches(rows);
  }
  /** Coach lines as `code<TAB>name<LF>` plus MIN(start)/MAX(end), assembled from book_coach for the page's bookings. */
  private attachCoaches(rows: Row[]): Row[] {
    const bookings = [...new Set(rows.map(row => String(row.bk_no)).filter(Boolean))];
    if (!bookings.length) return rows;
    const coaches = this.db.prepare(
      `SELECT bk_no,line_no,start_time,end_time,salesman_code,salesman_name FROM book_coach WHERE bk_no IN (${bookings.map(() => '?').join(',')}) ORDER BY bk_no,line_no`).all(...bookings) as Row[];
    const byBooking = new Map<string, Row[]>();
    for (const coach of coaches) {
      const key = String(coach.bk_no);
      byBooking.set(key, [...(byBooking.get(key) ?? []), coach]);
    }
    for (const row of rows) {
      const lines = byBooking.get(String(row.bk_no)) ?? [];
      row.coach_list = lines.map(line => `${String(line.salesman_code ?? '').trimEnd()}\t${String(line.salesman_name ?? '').trimEnd()}\n`).join('');
      const starts = lines.map(line => line.start_time).filter(Boolean).sort();
      const ends = lines.map(line => line.end_time).filter(Boolean).sort();
      row.coach_start = starts.length ? new Date(`${starts[0]}Z`) : null;
      row.coach_end = ends.length ? new Date(`${ends[ends.length - 1]}Z`) : null;
    }
    return rows;
  }
  async page(resource: Resource, query: Query): Promise<GlacierPage<ResourceItem>> {
    const rows = this.rawPage(resource, query);
    const complete = rows.length <= query.limit;
    const issues: GlacierIssue[] = [];
    const mapper = resource === 'students' ? studentRow : resource === 'packages' ? packageRow : resource === 'tuition-payments' ? paymentRow : lessonRow;
    let items: ResourceItem[] = rows.slice(0, query.limit).map(row => mapper(row, issues));
    if (query.mobile) items = items.filter(item => onMobile(item, query.mobile!));
    return { items, complete, nextCursor: complete ? null : encodeCursor(cursorScope(resource, query), String(rows[query.limit - 1]._id)), source: await this.source(), issues };
  }
  async context(studentId: string, query: Query): Promise<GlacierContext | null> {
    return contextFrom(this, studentId, query, await this.source());
  }
  async customerContext(mobile: string, studentId: string | undefined, now = new Date()): Promise<GlacierCustomerContext> {
    return customerContextFrom(this, mobile, studentId, now, await this.source());
  }
  async close(): Promise<void> { this.db.close(); }
}
export { ApiError };
