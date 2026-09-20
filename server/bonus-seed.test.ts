import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { seedBonus } from "./bonus-seed.js";
import { bonusBalance, bonusRedeemables, bonusCashScheme } from "./bonus-store.js";
import { importCustomers, migrateCustomerDirectory } from "./customer-directory.js";

test("seeds members, periods, ledger, redeemables and tiers idempotently", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const first = seedBonus(db);
    assert.equal(first.members, 6);
    assert.equal(first.ledger, 11);
    assert.equal(first.redeemables, 9);
    assert.equal(first.tiers, 3);
    const second = seedBonus(db);
    assert.deepEqual(second, first);
  } finally { db.close(); }
});

test("staff balances resolve active members while retired demo accounts stay unavailable", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedBonus(db);
    // Pin the clock inside the 2026A window so expiry-dependent counts stay
    // deterministic after the demo periods pass in real time.
    const now = new Date("2026-09-18T12:00:00Z");
    const byCode = bonusBalance(db, "DF1005", now);
    assert.equal(byCode.member.memberCode, "DF1005");
    assert.equal(byCode.member.grade, "Gold Feather");
    assert.equal(byCode.availablePoints, 1360);
    const byLocalMobile = bonusBalance(db, "61234505", now);
    assert.equal(byLocalMobile.member.memberCode, "DF1005");
    assert.equal(byCode.expiringSoon.date, "2026-10-31");
    for (const retired of ["DF-DEMO-AU", "DF-DEMO-HK", "+85261234591", "+85261234592"]) {
      assert.throws(() => bonusBalance(db, retired, now), /UNKNOWN_MEMBER/);
    }
    assert.throws(() => bonusBalance(db, "DF1001", now), /UNKNOWN_MEMBER/);
    assert.throws(() => bonusBalance(db, "NOBODY99", now), /UNKNOWN_MEMBER/);
  } finally { db.close(); }
});

test("an imported live roster stays authoritative and takes only its own ledger", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateCustomerDirectory(db);
    importCustomers(db, [{ id: "DF1005", name: "Live imported member", phone: "+85261234505" }]);
    const summary = seedBonus(db);
    // No synthetic members are added next to a live roster, and demo history
    // is written only for member codes that exist (the FK-safe path the Pi
    // takes when its imported roster is incomplete).
    assert.equal(summary.members, 1);
    assert.equal(summary.ledger, 2);
    const balance = bonusBalance(db, "+852 6123 4505", new Date("2026-09-18T12:00:00Z"));
    assert.equal(balance.member.memberName, "Live imported member");
    assert.equal(balance.availablePoints, 1360);
  } finally { db.close(); }
});

test("redeemables personalise affordability and the cash scheme keeps its tiers", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedBonus(db);
    const now = new Date("2026-09-18T12:00:00Z");
    const forGold = bonusRedeemables(db, "DF1005", now);
    assert.equal(forGold.items.length, 11);
    assert.equal(forGold.items[0].affordable, true);
    assert.equal(forGold.items.find(item => item.itemCode === "GIFT-DF01")?.affordable, false);
    // This active member cannot yet afford the cheapest redeemable (320 PTS).
    const forDuckling = bonusRedeemables(db, "DF1007", now);
    assert.equal(forDuckling.items.every(item => !item.affordable), true);
    const anonymous = bonusRedeemables(db, undefined, now);
    assert.equal(anonymous.availablePoints, null);
    const scheme = bonusCashScheme(db, now);
    assert.equal(scheme.scheme.baseRatio.cash, 1);
    assert.deepEqual(scheme.scheme.tiers, [{ minPoints: 100, cashValue: 1 }, { minPoints: 500, cashValue: 5 }, { minPoints: 1000, cashValue: 12 }]);
  } finally { db.close(); }
});
