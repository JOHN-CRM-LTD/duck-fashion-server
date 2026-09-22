/**
 * Read contract shared by the Glacier adapter (`glacier-api/`) and JohnCRM.
 *
 * Version 2 (2026-09-17): rows are keyed by the native booking tables and carry the student's mobile number,
 * which is the identity and the WhatsApp destination. Semantics copied from the native Booking app's own
 * queries (see tasks/glacier-restructure-2026-09-17/source-evidence-2026-09-17.md):
 *  - a live class is `book_info.bk_status NOT IN ('C','D')`; an unattended seat is `course_showup.showup_status = '*'`;
 *  - `bk_date` is a datetime compared with datetime parameters; dates in this contract are `yyyy-mm-dd` strings in the source zone;
 *  - a package's remaining lessons are `course_student.bal_lesson`; `con_lesson` only advances when the class is posted (`D`).
 */
export interface GlacierSource {
  mode: 'sql' | 'fixture';
  observedAt: string;
  dataAsOf: string;
  timeZone: string;
}

export interface GlacierIssue {
  code: string;
  entityId?: string;
  message: string;
}

/** Who a row is about and where a message for it goes. `mobile` is E.164 when the stored value is usable. */
export interface GlacierIdentity {
  studentId: string;
  studentName: string;
  /** Preferred destination (first usable number), E.164. */
  mobile: string | null;
  /** Every usable number found in the stored value (siblings and two-number entries), E.164. */
  mobiles: string[];
  mobileRaw: string | null;
  /** Parent name from the record when that parent's phone is the mobile, else null (the message then addresses the student). */
  recipientName: string | null;
}

export type GlacierSeatStatus = 'pending' | 'attended' | 'manual_checkin' | 'manual_showup' | 'no_show_deduct' | 'no_show' | 'cancelled' | 'unknown';
export type GlacierClassStatus = 'booked' | 'served' | 'posted' | 'cancelled' | 'hold' | 'unknown';
export type GlacierLessonStatus = 'scheduled' | 'completed' | 'cancelled' | 'unknown';

export interface GlacierCoach { code: string; name: string }

/** One student's seat in one class occurrence (`course_showup` ⋈ `book_info`). */
export interface GlacierLessonRow extends GlacierIdentity {
  /** `bk_no:mbr_code` */
  lessonId: string;
  bookingNo: string;
  courseNo: string;
  courseName: string;
  /** `yyyy-mm-dd` in the source zone (`book_info.bk_date`). */
  date: string;
  /** ISO instants with offset. */
  start: string;
  end: string;
  coaches: GlacierCoach[];
  location: string | null;
  seatStatus: GlacierSeatStatus;
  classStatus: GlacierClassStatus;
  status: GlacierLessonStatus;
  /** Hash of the facts a change notification compares (start, end, coaches, location, status). */
  version: string;
}

export interface GlacierPackageRow extends GlacierIdentity {
  /** `course_no:mbr_code` */
  packageId: string;
  courseNo: string;
  courseName: string;
  status: 'active' | 'cancelled' | 'ended' | 'unknown';
  /** ISO instant of `course.expire_date`, or null. */
  expiry: string | null;
  purchased: number | null;
  posted: number | null;
  /** `bal_lesson`: purchased lessons not yet posted; includes pending seats and attended-but-unposted seats. */
  remaining: number | null;
  pending: number;
  attendedUnposted: number;
  unallocated: number | null;
  /** False when the source's own counters disagree with the seat rows; callers must then surface an unknown, not a number. */
  entitlementVerified: boolean;
  renewalReference: string | null;
  issues: GlacierIssue[];
}

export interface GlacierPaymentRow extends GlacierIdentity {
  /** `trx_hdr_bk.trx_no` */
  paymentId: string;
  packageId: string | null;
  courseNo: string | null;
  courseName: string | null;
  amount: string;
  currency: string | null;
  paidAt: string | null;
  updatedAt: string | null;
  status: 'confirmed' | 'cancelled' | 'unknown';
}

export interface GlacierStudentRow extends GlacierIdentity {
  status: 'active' | 'inactive' | 'unknown';
}

/** Everything a customer conversation may be told, keyed by the number the message came from. */
export interface GlacierCustomerContext {
  mobile: string;
  students: Array<{
    student: GlacierStudentRow;
    packages: GlacierPackageRow[];
    lessons: GlacierLessonRow[];
    payments: GlacierPaymentRow[];
  }>;
  source: GlacierSource;
  issues: GlacierIssue[];
}

export interface GlacierPage<T> {
  items: T[];
  nextCursor: string | null;
  complete: boolean;
  source: GlacierSource;
  issues: GlacierIssue[];
}

export interface GlacierApiError {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------------------------------------------
// Version-1 per-student context, still served by GET /v1/students/{id}/automation-context.
// ---------------------------------------------------------------------------------------------------

export interface GlacierRecipient {
  key: string;
  name: string;
  phone: string;
  role: 'student' | 'billing_contact';
  mappingValid: boolean;
}

export interface GlacierStudent {
  id: string;
  name: string;
  state: 'enrolled' | 'departed' | 'unknown';
  recipient: GlacierRecipient | null;
  departureReference: string | null;
}

export interface GlacierPackage {
  id: string;
  studentId: string;
  remainingLessons: number | null;
  expiry: string | null;
  status: 'active' | 'cancelled' | 'completed' | 'unknown';
  renewalReference: string | null;
}

export interface GlacierPayment {
  id: string;
  studentId: string;
  packageId: string;
  amount: string;
  currency: string;
  confirmedAt: string | null;
  status: 'confirmed' | 'cancelled' | 'unknown';
}

export interface GlacierLesson {
  id: string;
  studentId: string;
  start: string;
  end: string;
  location: string | null;
  status: 'scheduled' | 'cancelled' | 'completed' | 'unknown';
  version: string;
}

export interface GlacierContext {
  student: GlacierStudent;
  packages: GlacierPackage[];
  payments: GlacierPayment[];
  lessons: GlacierLesson[];
  source: GlacierSource;
  issues: GlacierIssue[];
}
