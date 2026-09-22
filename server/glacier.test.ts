import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { Server } from "node:http";
import { seedGlacierSnapshot } from "./glacier-seed.js";
import { SqliteGlacierProvider } from "./glacier/sqlite-provider.js";
import { createGlacierRouter } from "./glacier/router.js";

/**
 * A miniature IceRink snapshot in the exact exporter format (tabs separate fields, \N is NULL):
 * two siblings sharing one written number, a parent recipient on that number, one active package
 * with mismatching counters, one posted class, one scheduled class, one confirmed SA5 payment.
 */
const rows = (fields: (string | null)[][]) => fields.map(row => row.map(field => field ?? "\\N").join("\t")).join("\n");
const SNAPSHOT = [
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

const API_KEY = "ab".repeat(32);
const directory = mkdtempSync(join(tmpdir(), "glacier-test-"));
let provider: SqliteGlacierProvider;
let server: Server;
let base: string;

before(async () => {
  const snapshot = join(directory, "snapshot.tsv.gz");
  writeFileSync(snapshot, gzipSync(Buffer.from(SNAPSHOT, "utf8")));
  const result = await seedGlacierSnapshot(snapshot, join(directory, "glacier.sqlite"));
  assert.equal(result.dataAsOf, "2026-07-30T12:00:00.000");
  assert.deepEqual(result.tables, {
    member_info: 4, lesson_type: 1, course: 2, course_student: 3, course_showup: 3, book_info: 2, book_coach: 2, trx_hdr_bk: 1, trx_payment_bk: 1,
  });
  provider = SqliteGlacierProvider.open(join(directory, "glacier.sqlite"));
  const app = express();
  app.use("/glacier", createGlacierRouter(provider, API_KEY));
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/glacier`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await provider.close();
  rmSync(directory, { recursive: true, force: true });
});

const authed = (path: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${API_KEY}` } });

test("health is open and reports the source", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});

test("every route except health requires the glacier bearer token", async () => {
  assert.equal((await fetch(`${base}/v1/students`)).status, 401);
  assert.equal((await fetch(`${base}/v1/lessons?date=2026-07-31`)).status, 401);
});

test("non-GET methods are refused with READ_ONLY", async () => {
  const response = await fetch(`${base}/v1/students`, { method: "POST", headers: { authorization: `Bearer ${API_KEY}` } });
  assert.equal(response.status, 405);
  assert.equal((await response.json()).error.code, "READ_ONLY");
});

test("scheduled lessons for a day, with coaches from book_coach", async () => {
  const page = await (await authed("/v1/lessons?date=2026-07-31&status=scheduled")).json();
  assert.equal(page.items.length, 2);
  const lesson = page.items.find((item: { studentId: string }) => item.studentId === "M1001");
  assert.equal(lesson.lessonId, "BK1:M1001");
  assert.equal(lesson.date, "2026-07-31");
  assert.equal(lesson.start, "2026-07-31T01:00:00.000Z"); // 09:00 HK wall clock
  assert.equal(lesson.end, "2026-07-31T02:00:00.000Z");
  assert.deepEqual(lesson.coaches, [{ code: "N01", name: "Coach Ng" }, { code: "N02", name: "Coach Lee" }]);
  assert.equal(lesson.location, "Rink A");
  assert.equal(lesson.seatStatus, "pending");
  assert.equal(lesson.classStatus, "booked");
  assert.equal(lesson.status, "scheduled");
  assert.equal(page.source.mode, "sql");
  assert.equal(page.source.dataAsOf, "2026-07-30T04:00:00.000Z"); // 12:00 HK wall clock as an instant
  assert.equal(page.source.timeZone, "Asia/Hong_Kong");
});

test("students by mobile returns every student on the number, including the sibling spelling", async () => {
  const page = await (await authed(`/v1/students?mobile=${encodeURIComponent("+85299999999")}`)).json();
  assert.deepEqual(page.items.map((item: { studentId: string }) => item.studentId).sort(), ["M1001", "M1002"]);
  const student = page.items.find((item: { studentId: string }) => item.studentId === "M1001");
  assert.equal(student.status, "active");
  assert.equal(student.recipientName, "Chan Father"); // parent phone matches the mobile
  assert.equal(student.mobileRaw, "99999999");
});

test("student status falls back to inactive when no enrolment is live", async () => {
  const page = await (await authed(`/v1/students?mobile=${encodeURIComponent("+85291234567")}`)).json();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].status, "inactive"); // only enrolment is cancelled and the course ended
});

test("packages carry the seat-derived counters and flag unverified entitlement", async () => {
  const page = await (await authed("/v1/packages?studentId=M1001")).json();
  assert.equal(page.items.length, 1);
  const pkg = page.items[0];
  assert.equal(pkg.packageId, "C1001:M1001");
  assert.equal(pkg.status, "active");
  assert.equal(pkg.remaining, 8);
  assert.equal(pkg.purchased, 10);
  assert.equal(pkg.posted, 2);
  assert.equal(pkg.pending, 1);      // '*' seat on the booked BK1
  assert.equal(pkg.attendedUnposted, 1); // 'S' seat on the served BK2
  assert.equal(pkg.unallocated, 6);
  assert.equal(pkg.entitlementVerified, false); // con_lesson=2 disagrees with the 0 posted seats
  assert.ok(pkg.issues.some((issue: { code: string }) => issue.code === "ENTITLEMENT_UNVERIFIED"));
  assert.equal(pkg.expiry, "2026-12-30T16:00:00.000Z"); // 2026-12-31 HK midnight
  assert.equal(pkg.renewalReference, "T9001");
});

test("activeOnly drops cancelled enrolments and ended courses", async () => {
  const page = await (await authed("/v1/packages?studentId=M1003&activeOnly=true")).json();
  assert.equal(page.items.length, 0);
});

test("tuition payments classify a settled SA5 sale as confirmed", async () => {
  const page = await (await authed("/v1/tuition-payments?studentId=M1001")).json();
  assert.equal(page.items.length, 1);
  const payment = page.items[0];
  assert.equal(payment.paymentId, "T9001");
  assert.equal(payment.status, "confirmed");
  assert.equal(payment.amount, "3000.00");
  assert.equal(payment.currency, "HKD");
  assert.equal(payment.paidAt, "2026-06-15T06:30:00.000Z");
  assert.equal(payment.packageId, "C1001:M1001");
});

test("since is required without a student and must be an offset timestamp", async () => {
  assert.equal((await authed("/v1/tuition-payments")).status, 400);
  assert.equal((await authed("/v1/tuition-payments?since=2026-07-01T00:00:00")).status, 400);
  assert.equal((await authed("/v1/tuition-payments?since=2026-07-01T00:00:00Z")).status, 200);
});

test("customer context aggregates every student on the number", async () => {
  const context = await (await authed(`/v1/customer-context?mobile=${encodeURIComponent("+85299999999")}`)).json();
  assert.equal(context.mobile, "+85299999999");
  assert.deepEqual(context.students.map((entry: { student: { studentId: string } }) => entry.student.studentId).sort(), ["M1001", "M1002"]);
  const entry = context.students.find((item: { student: { studentId: string } }) => item.student.studentId === "M1001");
  assert.equal(entry.packages.length, 1);
  assert.equal(entry.student.recipientName, "Chan Father");
  assert.equal((await authed(`/v1/customer-context?mobile=${encodeURIComponent("+85299999999")}&studentId=M9999`)).status, 404);
});

test("version-1 automation context keeps the recipient contract", async () => {
  const context = await (await authed("/v1/students/M1001/automation-context?from=2026-07-31T00:00:00Z")).json();
  assert.equal(context.student.id, "M1001");
  assert.equal(context.student.recipient.phone, "+85299999999");
  assert.equal(context.student.recipient.role, "billing_contact");
  assert.ok(context.lessons.some((lesson: { id: string; status: string }) => lesson.id === "BK1:M1001" && lesson.status === "scheduled"));
});

test("query validation matches the reference adapter", async () => {
  assert.equal((await authed("/v1/students?what=no")).status, 400);
  assert.equal((await authed("/v1/students?limit=0")).status, 400);
  assert.equal((await authed("/v1/students?limit=501")).status, 400);
  assert.equal((await authed("/v1/lessons?date=2026-07-31&from=2026-07-01")).status, 400);
  assert.equal((await authed("/v1/lessons?date=2026-7-31")).status, 400);
  assert.equal((await authed("/v1/lessons?status=cancelled")).status, 400);
  assert.equal((await authed("/v1/students?mobile=12345")).status, 400);
  assert.equal((await authed("/v1/nope")).status, 404);
  assert.equal((await authed("/v1/students?cursor=not-a-cursor")).status, 400);
});

test("keyset pagination walks large pages in _id order", async () => {
  const first = await (await authed("/v1/students?limit=2")).json();
  assert.equal(first.items.length, 2);
  assert.equal(first.complete, false);
  assert.ok(first.nextCursor);
  const second = await (await authed(`/v1/students?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.equal(second.items.length, 2);
  assert.equal(second.complete, true);
  const all = [...first.items, ...second.items].map((item: { studentId: string }) => item.studentId);
  assert.deepEqual([...all].sort(), ["M1001", "M1002", "M1003", "M1004"]);
});
