/**
 * A miniature IceRink snapshot in the exact exporter format (tabs separate fields, \N is NULL):
 * two siblings sharing one written number, a parent recipient on that number, one active package
 * with mismatching counters, one posted class, one scheduled class, one confirmed SA5 payment.
 */
const rows = (fields: (string | null)[][]) => fields.map(row => row.map(field => field ?? "\\N").join("\t")).join("\n");
export const SNAPSHOT = [
  "# glacier-icerink snapshot v1",
  "# exportedAt 2026-07-30T08:00:00.000",
  "# dataAsOf 2026-07-30T12:00:00.000",
  "# table member_info",
  "# columns mbr_code,mbr_name,mbr_mobile,mbr_status,parent_name1,parent_phone1,parent_name2,parent_phone2",
  rows([
    ["M1001", "Chan Tai Man", "99999999", "A", "Chan Father", "99999999", null, null],
    ["M1002", "Chan Tai Woman", "99999999/99999999", "A", null, null, null, null],
    ["M1003", "Wong Siu Ming", "+852 9123 4567", "A", null, null, null, null],
    ["M1004", "Lau Siu Fong", null, "A", null, null, null, null],
  ]),
  "# table lesson_type",
  "# columns lesson_type,lesson_desc",
  rows([["LT1", "Group Lesson"]]),
  "# table course",
  "# columns course_no,lesson_type,course_desc,course_status,expire_date,rink_area",
  rows([
    ["C1001", "LT1", "Skating Basic", "A", "2026-12-31T00:00:00.000", "Rink A"],
    ["C1002", "LT1", "Skating Advanced", "T", "2026-01-31T00:00:00.000", "Rink B"],
  ]),
  "# table course_student",
  "# columns course_no,line_no,mbr_code,status,tot_lesson,con_lesson,bal_lesson,trx_no,updated_on",
  rows([
    ["C1001", "1", "M1001", "A", "10", "2", "8", "T9001", "2026-06-15T14:30:00.000"],
    ["C1001", "2", "M1002", "A", "10", "0", "10", "T9002", "2026-06-16T10:00:00.000"],
    ["C1002", "1", "M1003", "C", "4", "4", "0", "T9003", "2025-11-01T09:00:00.000"],
  ]),
  "# table course_showup",
  "# columns course_no,bk_no,mbr_code,showup_status",
  rows([
    ["C1001", "BK1", "M1001", "*"],
    ["C1001", "BK1", "M1002", "*"],
    ["C1001", "BK2", "M1001", "S"],
  ]),
  "# table book_info",
  "# columns bk_no,course_no,bk_status,bk_date,start_time,end_time",
  rows([
    ["BK1", "C1001", "B", "2026-07-31T00:00:00.000", "2000-01-01T09:00:00.000", "2000-01-01T10:00:00.000"],
    ["BK2", "C1001", "S", "2026-07-20T00:00:00.000", "2000-01-01T11:00:00.000", "2000-01-01T12:00:00.000"],
  ]),
  "# table book_coach",
  "# columns bk_no,line_no,start_time,end_time,salesman_code,salesman_name",
  rows([
    ["BK1", "1", "2026-07-31T09:00:00.000", "2026-07-31T09:30:00.000", "N01", "Coach Ng"],
    ["BK1", "2", "2026-07-31T09:30:00.000", "2026-07-31T10:00:00.000", "N02", "Coach Lee"],
  ]),
  "# table trx_hdr_bk",
  "# columns trx_no,mbr_code,course_no,course_name,parent_type,trx_type,trx_status,trx_date,updated_on,total_amt,recv_amt,chg_amt",
  rows([["T9001", "M1001", "C1001", "Skating Basic", "SAL", "SA5", "M", "2026-06-15T14:30:00.000", "2026-06-15T14:31:00.000", "3000", "3000", "0"]]),
  "# table trx_payment_bk",
  "# columns trx_no,pay_bas_amt,curr_code",
  rows([["T9001", "3000", "HKD"]]),
  "",
].join("\n");
