import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { seedBonus } from "./bonus-seed.js";
import { bonusRedeemables, memberBalance } from "./bonus-store.js";
import { redeemBonusCoupon, memberCoupons } from "./bonus-coupons.js";

const now = new Date("2026-09-21T12:00:00Z");
const input = { member: "DF1010", phone: "+85261234510", rewardId: "CASH-500", expectedPoints: 500, expectedAmount: 5, expectedName: "Duck Fashion HK$5 cash coupon", requestId: "crm-test-request-0001" };
function fixture() { const db = new DatabaseSync(":memory:"); seedBonus(db); return db; }
test("the catalogue publishes exact item vouchers and cash coupons matching the tiers", () => {
  const db = fixture(); try {
    const data = bonusRedeemables(db, "DF1010", now);
    assert.ok(data.items.every(item => Number.isSafeInteger(item.pointsNeeded) && item.pointsNeeded > 0));
    const cash = data.items.find(item => item.itemCode === "CASH-500")!;
    assert.equal(cash.couponAmount, 5); assert.equal(cash.pointsNeeded, 500); assert.equal(cash.affordable, true);
    assert.equal(data.items.find(item => item.itemCode === "CASH-1000")!.affordable, false);
  } finally { db.close(); }
});
test("one transaction deducts points and issues an exact coupon; replay never charges twice", () => {
  const db = fixture(); try {
    const result = redeemBonusCoupon(db, input, now);
    assert.equal(result.pointsSpent, 500); assert.equal(result.balanceAfter, 220);
    assert.equal(result.coupon.coupon_amt, 5); assert.match(result.coupon.br_no, /^DF-[A-F0-9]{24}$/);
    assert.equal(result.coupon.expiry_date, "2026-10-21T12:00:00.000Z");
    assert.deepEqual(redeemBonusCoupon(db, input, new Date("2026-09-22")), result);
    seedBonus(db); assert.equal(memberBalance(db, input.member, now).availablePoints, 220);
    assert.equal(memberCoupons(db, input.phone).length, 1);
    assert.throws(() => redeemBonusCoupon(db, { ...input, rewardId: "DF07" }, now), /IDEMPOTENCY_CONFLICT/);
    assert.equal(memberBalance(db, input.member, now).availablePoints, 220);
  } finally { db.close(); }
});
test("insufficient points, changed costs, expired points and mismatched identities never debit", () => {
  const db = fixture(); try {
    for (const [data, date, reason] of [
      [{ ...input, rewardId: "CASH-1000", expectedPoints: 1000, expectedAmount: 12, expectedName: "Duck Fashion HK$12 cash coupon" }, now, /INSUFFICIENT_POINTS/],
      [{ ...input, expectedPoints: 100 }, now, /REWARD_CHANGED/],
      [{ ...input, phone: "+85261234505" }, now, /MEMBER_VERIFICATION_FAILED/],
      [input, new Date("2028-01-01"), /INSUFFICIENT_POINTS/],
    ] as const) assert.throws(() => redeemBonusCoupon(db, data, date), reason);
    assert.equal(memberBalance(db, input.member, now).availablePoints, 720);
    assert.deepEqual(memberCoupons(db, input.phone), []);
  } finally { db.close(); }
});

test("an issued coupon and deduction survive closing and reopening the SQLite database", () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-coupon-restart-"));
  let db = new DatabaseSync(join(directory, "duck.sqlite"));
  try {
    seedBonus(db);
    const receipt = redeemBonusCoupon(db, input, now);
    db.close();
    db = new DatabaseSync(join(directory, "duck.sqlite"));
    seedBonus(db);
    assert.deepEqual(redeemBonusCoupon(db, input, now), receipt);
    assert.equal(memberBalance(db, input.member, now).availablePoints, 220);
    assert.equal(memberCoupons(db, input.phone)[0].br_no, receipt.coupon.br_no);
  } finally {
    db.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected test directory");
    rmSync(directory, { recursive: true, force: true });
  }
});
test("redemption consumes the soonest expiring period first and rolls back coupon failures", () => {
  const db = fixture(); try {
    const result = redeemBonusCoupon(db, { ...input, member: "DF1006", phone: "+85261234506" }, now);
    assert.equal(result.balanceAfter, 300);
    const periods = memberBalance(db, "DF1006", now).periods;
    assert.equal(periods[0].points, 0); assert.equal(periods[1].points, 300);
    db.exec("CREATE TRIGGER fail_coupon BEFORE INSERT ON bonus_coupons BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => redeemBonusCoupon(db, { ...input, requestId: "crm-test-request-0002" }, now), /test failure/);
    assert.equal(memberBalance(db, input.member, now).availablePoints, 720);
  } finally { db.close(); }
});
