import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { importCustomers, lookupCustomer, migrateCustomerDirectory } from "./customer-directory.js";
const fixtures = [{ id: "TEST-HK", name: "Example customer", phone: "+85261234567" }, { id: "TEST-AU", name: "Example customer AU", phone: "+61412345678" }];
test("matches imported numbers in full without enrolling unknown callers", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateCustomerDirectory(db); importCustomers(db, fixtures);
    assert.equal(lookupCustomer(db, "+852 (6123) 4567").customers[0]?.id, "TEST-HK");
    assert.equal(lookupCustomer(db, "61412345678").customers[0]?.id, "TEST-AU");
    assert.deepEqual(lookupCustomer(db, "85261234568").customers, []);
    assert.deepEqual(lookupCustomer(db, "61234567").customers, []);
    assert.throws(() => lookupCustomer(db, "' OR 1=1"), /INVALID_CUSTOMER_PHONE/);
    assert.throws(() => lookupCustomer(db, ["85261234567"]), /INVALID_CUSTOMER_PHONE/);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM bonus_members").get() as { n: number }).n, 2);
    assert.throws(() => db.prepare("INSERT INTO bonus_members(member_code,name,mobile,grade,joined_on) VALUES('duplicate','Duplicate','+852 (6123) 4567','Duckling','2026-01-01')").run(), /UNIQUE/);
  } finally { db.close(); }
});
test("migration preserves member edits and deletions and shares the loyalty identity", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateCustomerDirectory(db); importCustomers(db, fixtures);
    db.prepare("DELETE FROM bonus_members WHERE member_code='TEST-AU'").run();
    db.prepare("UPDATE bonus_members SET mobile=NULL,grade='Gold Feather' WHERE member_code='TEST-HK'").run();
    migrateCustomerDirectory(db);
    assert.deepEqual(lookupCustomer(db, "85261234567").customers, []);
    assert.deepEqual(lookupCustomer(db, "61412345678").customers, []);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM bonus_members").get() as { n: number }).n, 1);
    importCustomers(db, [fixtures[0]]);
    assert.equal((db.prepare("SELECT grade FROM bonus_members WHERE member_code='TEST-HK'").get() as { grade: string }).grade, "Gold Feather");
  } finally { db.close(); }
});
test("staff imports are idempotent and reject ambiguous batches atomically", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateCustomerDirectory(db); importCustomers(db, fixtures); importCustomers(db, fixtures);
    assert.throws(() => importCustomers(db, [fixtures[0], fixtures[0]]), /INVALID_CUSTOMERS/);
    assert.throws(() => importCustomers(db, [{ ...fixtures[0], id: "other" }]), /CUSTOMER_PHONE_CONFLICT/);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM bonus_members").get() as { n: number }).n, 2);
  } finally { db.close(); }
});
