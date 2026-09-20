import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import * as directory from "./customer-directory.js";
import { seedBonus } from "./bonus-seed.js";
import { bonusBalance } from "./bonus-store.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  directory.migrateCustomerDirectory(db);
  const put = db.prepare("INSERT INTO bonus_members VALUES(?,?,?,?,?,?)");
  for (let i = 1; i <= 53; i++) put.run(`M${String(i).padStart(3, "0")}`, i === 2 ? "Percent %_ customer" : `Customer ${i}`, i === 1 ? "陳小明" : null, "Duckling", i === 53 ? null : `+852 61${String(i).padStart(6, "0")}`, "2026-01-01");
  seedBonus(db);
  return db;
}
test("customer browsing returns bounded stable pages and approved member fields without writing", () => {
  assert.equal(typeof directory.browseCustomers, "function");
  const db = fixture();
  try {
    const before = db.prepare("SELECT * FROM bonus_members ORDER BY member_code").all();
    const first = directory.browseCustomers(db, {});
    assert.equal(first.customers.length, 50);
    assert.equal(first.hasMore, true);
    assert.deepEqual(first.customers[0], { id: "M001", name: "Customer 1", nameZh: "陳小明", grade: "Duckling", phone: "+85261000001", joinedOn: "2026-01-01", membershipPoints: 0 });
    const last = directory.browseCustomers(db, { offset: "50", limit: "50" });
    assert.deepEqual(last.customers.map(c => c.id), ["M051", "M052", "M053"]);
    assert.equal(last.hasMore, false);
    assert.equal(last.customers[2].phone, null);
    assert.equal(directory.browseCustomers(db, { offset: "100" }).customers.length, 0);
    assert.deepEqual(db.prepare("SELECT * FROM bonus_members ORDER BY member_code").all(), before);
  } finally { db.close(); }
});

test("membership points use the current loyalty balance including redemptions and expiry", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedBonus(db);
    for (const now of [new Date("2026-09-20T12:00:00Z"), new Date("2026-11-03T12:00:00Z"), new Date("2027-05-03T12:00:00Z")]) {
      const page = directory.browseCustomers(db, {}, now);
      assert.equal(page.customers.length, 6);
      for (const row of page.customers) assert.equal(row.membershipPoints, bonusBalance(db, row.id, now).availablePoints);
    }
    const now = new Date("2026-09-20T12:00:00Z");
    const before = directory.browseCustomers(db, { query: "DF1005" }, now).customers[0].membershipPoints;
    db.prepare("INSERT INTO bonus_ledger(member_code,period,entry_type,points,trx_date,note) VALUES('DF1005','2026B','redeem_cash',-100,'2026-09-20','test redemption')").run();
    assert.equal(directory.browseCustomers(db, { query: "DF1005" }, now).customers[0].membershipPoints, before - 100);
  } finally { db.close(); }
});

test("archiving demo IDs removes all active reads and preserves member and ledger history across boots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    directory.migrateCustomerDirectory(db);
    directory.importCustomers(db, [
      { id: "DF-DEMO-AU", name: "Archived example AU", phone: "+85261234591" },
      { id: "DF-DEMO-HK", name: "Archived example HK", phone: "+85261234592" },
      { id: "DF1005", name: "Retained example", phone: "+85261234505" },
    ]);
    seedBonus(db);
    db.prepare("INSERT INTO bonus_ledger(member_code,period,entry_type,points,trx_date,note) VALUES('DF-DEMO-AU','2026B','earn',260,'2026-09-17','preserved history')").run();
    const members = db.prepare("SELECT * FROM bonus_members ORDER BY member_code").all();
    const ledger = db.prepare("SELECT * FROM bonus_ledger ORDER BY id").all();
    for (let boot = 0; boot < 2; boot++) {
      seedBonus(db);
      assert.deepEqual(directory.browseCustomers(db, {}).customers.map(row => row.id), ["DF1005"]);
      assert.equal(directory.browseCustomers(db, { query: "DF-DEMO" }).customers.length, 0);
      for (const phone of ["+85261234591", "+85261234592"]) assert.deepEqual(directory.lookupCustomer(db, phone).customers, []);
      for (const reference of ["DF-DEMO-AU", "DF-DEMO-HK", "+85261234591", "Archived example HK"]) assert.throws(() => bonusBalance(db, reference), /UNKNOWN_MEMBER/);
      assert.deepEqual(db.prepare("SELECT * FROM bonus_members ORDER BY member_code").all(), members);
      assert.deepEqual(db.prepare("SELECT * FROM bonus_ledger ORDER BY id").all(), ledger);
    }
    assert.throws(() => directory.importCustomers(db, [
      { id: "NEW-MEMBER", name: "Another customer", phone: "+85261234591" },
    ]), /CUSTOMER_PHONE_CONFLICT/);
    assert.deepEqual(db.prepare("SELECT * FROM bonus_members ORDER BY member_code").all(), members);
  } finally { db.close(); }
});
test("browse searches literal names, Chinese names, member IDs and formatted phones", () => {
  assert.equal(typeof directory.browseCustomers, "function");
  const db = fixture();
  try {
    for (const query of ["customer 1", "陳", "M001", "+852 (6100) 0001"]) assert.equal(directory.browseCustomers(db, { query }).customers[0].id, "M001");
    assert.deepEqual(directory.browseCustomers(db, { query: "%_" }).customers.map(c => c.id), ["M002"]);
    assert.equal(directory.browseCustomers(db, { query: "' OR 1=1 --" }).customers.length, 0);
    assert.equal(directory.browseCustomers(db, { query: "missing" }).hasMore, false);
    assert.equal(directory.lookupCustomer(db, "+85261000001").customers.length, 1);
    assert.throws(() => directory.lookupCustomer(db, undefined), /INVALID_CUSTOMER_PHONE/);
  } finally { db.close(); }
});
test("browse rejects malformed or excessive pagination instead of returning an unbounded directory", () => {
  assert.equal(typeof directory.browseCustomers, "function");
  const db = fixture();
  try {
    for (const input of [{ limit: "51" }, { limit: "0" }, { offset: "-1" }, { offset: "1.5" }, { offset: "1000001" }, { limit: ["5"] }, { query: ["name"] }, { query: "a".repeat(201) }]) {
      assert.throws(() => directory.browseCustomers(db, input), /INVALID_CUSTOMER_SEARCH/);
    }
  } finally { db.close(); }
});
