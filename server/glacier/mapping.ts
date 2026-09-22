import { createHash } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { GlacierClassStatus, GlacierCoach, GlacierIdentity, GlacierIssue, GlacierLesson, GlacierLessonRow, GlacierLessonStatus, GlacierPackage, GlacierPackageRow, GlacierPayment, GlacierPaymentRow, GlacierSeatStatus, GlacierStudent, GlacierStudentRow } from './contract.js';

export type Row = Record<string, unknown>;
export const HK_OFFSET_MS = 8 * 3_600_000;
export const value = (v: unknown): string => v == null ? '' : String(v).trim();
export const number = (v: unknown): number | null => v == null || value(v) === '' || !Number.isFinite(Number(v)) ? null : Number(v);
/** Money as a 2 dp string; null/invalid → '0.00'. */
export const money = (v: unknown): string => (number(v) ?? 0).toFixed(2);

// ---------------------------------------------------------------------------------------------------
// Time. SQL Server datetimes are Hong Kong wall clock without offset. The pool runs with useUTC, so the driver
// materialises a column as a Date whose UTC components equal the wall clock, and serialises a Date parameter's
// UTC components as the wall clock. Never wrap a column in CONVERT; shift the parameter instead.
// ---------------------------------------------------------------------------------------------------
export function sqlTime(v: unknown): string | null {
  if (v == null || v === '') return null;
  const raw = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(raw.valueOf()) ? new Date(raw.valueOf() - HK_OFFSET_MS).toISOString() : null;
}
/** `yyyy-mm-dd` of a wall-clock column value. */
export function sqlDay(v: unknown): string | null {
  if (v == null || v === '') return null;
  const raw = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(raw.valueOf()) ? raw.toISOString().slice(0, 10) : null;
}
/** Parameter for `bk_date = @day`: a Date whose UTC components are HK midnight of that day. */
export const dayParameter = (day: string): Date => new Date(`${day}T00:00:00Z`);
export const addDays = (day: string, days: number): string => new Date(dayParameter(day).valueOf() + days * 86_400_000).toISOString().slice(0, 10);
/** Parameter equal to the HK wall clock of an instant. */
export const wallParameter = (instant: string | Date): Date => new Date(new Date(instant).valueOf() + HK_OFFSET_MS);
export const todayHk = (now = new Date()): string => new Date(now.valueOf() + HK_OFFSET_MS).toISOString().slice(0, 10);
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && dayParameter(v).toISOString().startsWith(v);
/** Combine a wall-clock day with the time-of-day of a `2000-01-01 hh:mm` dummy-dated column. */
function combineDayTime(day: unknown, time: unknown): string | null {
  const d = sqlDay(day); if (!d || !(time instanceof Date) || !Number.isFinite(time.valueOf())) return null;
  const midnight = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate());
  return sqlTime(new Date(dayParameter(d).valueOf() + (time.valueOf() - midnight)));
}

// ---------------------------------------------------------------------------------------------------
// Mobile identity (evidence §4): stored values are free text; split on separators, strip non-digits, drop a leading
// 852, accept 8-digit Hong Kong numbers; anything else must parse as a valid international number.
// ---------------------------------------------------------------------------------------------------
export function normaliseMobile(part: string): string | null {
  const trimmed = part.trim(); if (!trimmed) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('852')) digits = digits.slice(3);
  if (digits.length === 8) return `+852${digits}`;
  if (digits.length < 8) return null;
  const parsed = parsePhoneNumberFromString(`+${digits}`, 'HK');
  return parsed?.isValid() ? parsed.number : null;
}
export function normaliseMobiles(raw: unknown): string[] {
  const out: string[] = [];
  for (const part of value(raw).split(/[\/,;]/)) { const m = normaliseMobile(part); if (m && !out.includes(m)) out.push(m); }
  return out;
}
/** Raw spellings to look up with `mbr_mobile IN (...)` (index seek) plus LIKE patterns; callers post-filter with normaliseMobiles. */
export function mobileVariants(e164: string): { exact: string[]; prefix: string; infix: string } {
  const local = e164.startsWith('+852') ? e164.slice(4) : null;
  if (local) return { exact: [local, `852${local}`, `+852${local}`, `+852 ${local.slice(0, 4)} ${local.slice(4)}`, `852 ${local.slice(0, 4)} ${local.slice(4)}`], prefix: `${local}%`, infix: `%/${local}%` };
  return { exact: [e164, e164.slice(1)], prefix: `${e164}%`, infix: `%/${e164}%` };
}
export function identity(row: Row): GlacierIdentity {
  const studentId = value(row.mbr_code) || value(row._id);
  const mobiles = normaliseMobiles(row.mbr_mobile);
  const mobile = mobiles[0] ?? null;
  const parent1 = normaliseMobiles(row.parent_phone1), parent2 = normaliseMobiles(row.parent_phone2);
  const recipientName = mobile && parent1.includes(mobile) ? value(row.parent_name1) || null : mobile && parent2.includes(mobile) ? value(row.parent_name2) || null : null;
  return { studentId, studentName: value(row.mbr_name), mobile, mobiles, mobileRaw: value(row.mbr_mobile) || null, recipientName };
}
export const onMobile = (who: GlacierIdentity, mobile: string): boolean => who.mobiles.includes(mobile);

// ---------------------------------------------------------------------------------------------------
// Classifiers (evidence §1). Native report CASE for showup_status; bk_status lifecycle B→S→D, C cancelled, H hold.
// ---------------------------------------------------------------------------------------------------
export function seatStatus(code: unknown): GlacierSeatStatus {
  switch (value(code)) { case '*': return 'pending'; case 'S': return 'attended'; case 'I': return 'manual_checkin'; case 'M': return 'manual_showup'; case 'V': return 'no_show_deduct'; case 'N': return 'no_show'; case 'C': return 'cancelled'; default: return 'unknown'; }
}
export function classStatus(code: unknown): GlacierClassStatus {
  switch (value(code)) { case 'B': return 'booked'; case 'S': return 'served'; case 'D': return 'posted'; case 'C': return 'cancelled'; case 'H': return 'hold'; default: return 'unknown'; }
}
export function lessonStatus(seat: unknown, cls: unknown, courseStatus: unknown, enrolmentStatus: unknown): GlacierLessonStatus {
  const s = value(seat), b = value(cls);
  if (s === 'C' || b === 'C' || value(courseStatus) === 'C' || value(enrolmentStatus) === 'C') return 'cancelled';
  if (['S', 'I', 'M', 'V', 'N'].includes(s)) return 'completed';
  if (s === '*' && !['C', 'D'].includes(b)) return 'scheduled';
  return 'unknown';
}
export function parseCoaches(text: unknown): GlacierCoach[] {
  return value(text).split('\n').filter(Boolean).map(line => { const [code, name = ''] = line.split('\t'); return { code: code.trim(), name: name.trim() }; }).filter(c => c.code);
}
export const shortHash = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);

// ---------------------------------------------------------------------------------------------------
// Row mappers (version 2).
// ---------------------------------------------------------------------------------------------------
export function lessonRow(row: Row, issues: GlacierIssue[]): GlacierLessonRow {
  const who = identity(row);
  const lessonId = value(row._id);
  let start = sqlTime(row.coach_start), end = sqlTime(row.coach_end);
  if (!start || !end) { start = combineDayTime(row.bk_date, row.start_time); end = combineDayTime(row.bk_date, row.end_time); }
  if (!start || !end || start >= end || Number(start.slice(0, 4)) > 2100) { issues.push({ code: 'LESSON_TIME_INVALID', entityId: lessonId, message: 'Class timing could not be determined from coach or booking times.' }); start = start ?? ''; end = end ?? ''; }
  const coaches = parseCoaches(row.coach_list);
  const location = value(row.rink_area) || null;
  const status = lessonStatus(row.showup_status, row.bk_status, row.course_status, row.student_status);
  return { ...who, lessonId, bookingNo: value(row.bk_no), courseNo: value(row.course_no), courseName: value(row.course_desc) || value(row.lesson_desc), date: sqlDay(row.bk_date) ?? '',
    start, end, coaches, location, seatStatus: seatStatus(row.showup_status), classStatus: classStatus(row.bk_status), status,
    version: shortHash([start, end, coaches.map(c => c.code), location, status]) };
}
export function packageRow(row: Row, issues: GlacierIssue[]): GlacierPackageRow {
  const who = identity(row);
  const packageId = value(row._id);
  const own: GlacierIssue[] = [];
  const remaining = number(row.bal_lesson), purchased = number(row.tot_lesson), posted = number(row.con_lesson);
  const pending = number(row.pending) ?? 0, attendedUnposted = number(row.attended_unposted) ?? 0;
  const entitlementVerified = posted !== null && purchased !== null && posted === number(row.posted_seats) && purchased === number(row.live_seats);
  if (!entitlementVerified) own.push({ code: 'ENTITLEMENT_UNVERIFIED', entityId: packageId, message: 'Source lesson counters disagree with the seat rows; treat the remaining count as unknown.' });
  const enrolment = value(row.status), course = value(row.course_status);
  const status: GlacierPackageRow['status'] = enrolment === 'C' || course === 'C' ? 'cancelled' : course === 'T' ? 'ended' : enrolment && course ? 'active' : 'unknown';
  let expiry = sqlTime(row.expire_date);
  if (expiry && Number(expiry.slice(0, 4)) > 2100) { own.push({ code: 'PACKAGE_EXPIRY_INVALID', entityId: packageId, message: 'Source expiry is outside the supported range.' }); expiry = null; }
  issues.push(...own);
  return { ...who, packageId, courseNo: value(row.course_no), courseName: value(row.course_desc), status, expiry, purchased, posted, remaining, pending, attendedUnposted,
    unallocated: remaining === null ? null : remaining - pending - attendedUnposted, entitlementVerified, renewalReference: value(row.trx_no) || null, issues: own };
}
export function paymentRow(row: Row, issues: GlacierIssue[]): GlacierPaymentRow {
  const who = identity(row);
  const paymentId = value(row._id);
  const total = number(row.total_amt), received = number(row.recv_amt), change = number(row.chg_amt) ?? 0, tenders = number(row.tender_total);
  const cancelled = value(row.trx_status) === 'C';
  const currency = value(row.currency) || null;
  const paidAt = sqlTime(row.trx_date);
  const confirmed = !cancelled && paidAt !== null && value(row.trx_type) === 'SA5' && value(row.trx_status) === 'M' && total !== null && total > 0 && received !== null && tenders !== null
    && received - change >= total && Math.abs(tenders - received) < 0.000001 && /^[A-Z]{3}$/.test(currency ?? '');
  if (!confirmed && !cancelled) issues.push({ code: 'PAYMENT_UNCONFIRMED', entityId: paymentId, message: 'Sale header and tender lines do not establish settlement.' });
  const courseNo = value(row.course_no) || null;
  return { ...who, paymentId, packageId: courseNo && who.studentId ? `${courseNo}:${who.studentId}` : null, courseNo, courseName: value(row.course_name) || null, amount: money(row.total_amt), currency,
    paidAt, updatedAt: sqlTime(row.updated_on), status: cancelled ? 'cancelled' : confirmed ? 'confirmed' : 'unknown' };
}
export function studentRow(row: Row, _issues: GlacierIssue[]): GlacierStudentRow {
  const who = identity(row);
  const member = value(row.mbr_status), enrolments = number(row.active_enrolments) ?? 0;
  return { ...who, status: member === 'A' ? (enrolments > 0 ? 'active' : 'inactive') : 'unknown' };
}

// ---------------------------------------------------------------------------------------------------
// Version-1 shapes for GET /v1/students/{id}/automation-context and the booking context.
// ---------------------------------------------------------------------------------------------------
export function legacyStudent(s: GlacierStudentRow, issues: GlacierIssue[]): GlacierStudent {
  if (!s.mobile) issues.push({ code: 'RECIPIENT_UNRESOLVED', entityId: s.studentId, message: 'The stored mobile number is not usable.' });
  return { id: s.studentId, name: s.studentName, state: s.status === 'active' ? 'enrolled' : 'unknown',
    recipient: s.mobile ? { key: s.mobile, name: s.recipientName ?? s.studentName, phone: s.mobile, role: s.recipientName ? 'billing_contact' : 'student', mappingValid: true } : null, departureReference: null };
}
export const legacyPackage = (p: GlacierPackageRow): GlacierPackage => ({ id: p.packageId, studentId: p.studentId, remainingLessons: p.entitlementVerified ? p.remaining : null, expiry: p.expiry,
  status: p.status === 'ended' ? 'completed' : p.status, renewalReference: p.renewalReference });
export const legacyPayment = (p: GlacierPaymentRow): GlacierPayment => ({ id: p.paymentId, studentId: p.studentId, packageId: p.packageId ?? '', amount: p.amount, currency: p.currency ?? '', confirmedAt: p.status === 'confirmed' ? p.paidAt : null, status: p.status });
export const legacyLesson = (l: GlacierLessonRow): GlacierLesson => ({ id: l.lessonId, studentId: l.studentId, start: l.start, end: l.end, location: l.location, status: l.status, version: l.version });
