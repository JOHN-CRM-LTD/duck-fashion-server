import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import * as directory from "./customer-directory.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  directory.migrateCustomerDirectory(db);
  const put = db.prepare("INSERT INTO bonus_members VALUES(?,?,?,?,?,?)");
  for (let i = 1; i <= 53; i++) put.run(`M${String(i).padStart(3, "0")}`, i === 2 ? "Percent %_ customer" : `Customer ${i}`, i === 1 ? "陳小明" : null, "Duckling", i === 53 ? null : `+852 61${String(i).padStart(6, "0")}`, "2026-01-01");
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
    assert.deepEqual(first.customers[0], { id: "M001", name: "Customer 1", nameZh: "陳小明", grade: "Duckling", phone: "+85261000001", joinedOn: "2026-01-01" });
    const last = directory.browseCustomers(db, { offset: "50", limit: "50" });
    assert.deepEqual(last.customers.map(c => c.id), ["M051", "M052", "M053"]);
    assert.equal(last.hasMore, false);
    assert.equal(last.customers[2].phone, null);
    assert.equal(directory.browseCustomers(db, { offset: "100" }).customers.length, 0);
    assert.deepEqual(db.prepare("SELECT * FROM bonus_members ORDER BY member_code").all(), before);
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
