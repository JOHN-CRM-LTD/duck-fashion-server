import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateLocationDirectory, importLocationDirectory, browseLocationDirectory } from "./location-directory.js";
import { migrateLocationAdmin, readAdminLocation, updateAdminLocation, applyGitLocationChanges, locationHistory } from "./location-admin.js";

test("location edits validate, detect lost updates, audit and replay without overwriting newer edits", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT); INSERT INTO shops VALUES ('PCB','Old'),('PCL','Other')");
    migrateLocationDirectory(db); migrateLocationAdmin(db);
    importLocationDirectory(db, ["PCB", "PCL"].map((shop, i) => ({ id: i + 1, inventoryLocationId: shop, name: shop, country: "HK", timezone: "Asia/Hong_Kong", hours: {}, managerPhone: "+85261234567", isActive: true, isDefault: i === 1 })));
    const current = readAdminLocation(db, "PCB");
    const input = { requestId: "test-change-0001", expectedRevision: current.revision, changes: { managerPhone: "+85291234567", name: "Updated" }, reason: "Demo manager change" };
    for (const changes of [{ id: 2 }, { managerPhone: "91234567" }, { hours: { mon: [{ open: "20:00", close: "10:00" }] } }, { latitude: 22 }, { unexpected: true }, {}]) {
      assert.throws(() => updateAdminLocation(db, "PCB", { ...input, changes }));
      assert.equal(readAdminLocation(db, "PCB").revision, current.revision);
    }
    assert.throws(() => updateAdminLocation(db, "PCB", { ...input, changes: { isDefault: true } }), /MULTIPLE_DEFAULT/);
    const changed = updateAdminLocation(db, "PCB", input);
    assert.equal(changed.location.managerPhone, "+85291234567");
    assert.equal(changed.location.isDefault, false);
    assert.equal(db.prepare("SELECT name FROM shops WHERE id='PCB'").get()!.name, "Updated");
    assert.equal(locationHistory(db, "PCB")[0].before.managerPhone, "+85261234567");
    assert.throws(() => updateAdminLocation(db, "PCB", { ...input, requestId: "test-change-0002" }), /LOCATION_CONFLICT/);
    updateAdminLocation(db, "PCB", { ...input, requestId: "test-change-0002", expectedRevision: changed.revision, changes: { managerPhone: "+85291234568" } });
    assert.equal(updateAdminLocation(db, "PCB", input).replayed, true);
    assert.equal(readAdminLocation(db, "PCB").location.managerPhone, "+85291234568");
    assert.equal(locationHistory(db, "PCB").length, 2);
    assert.throws(() => updateAdminLocation(db, "PCB", { ...input, changes: { managerPhone: "+85291234569" } }), /IDEMPOTENCY_CONFLICT/);
  } finally { db.close(); }
});

test("Git location change batches are atomic and each change applies only once", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT); INSERT INTO shops VALUES ('PCB','Old')");
    migrateLocationDirectory(db); migrateLocationAdmin(db);
    importLocationDirectory(db, [{ id: 1, inventoryLocationId: "PCB", name: "Old", country: "HK", timezone: "Asia/Hong_Kong", hours: {}, isActive: true }]);
    const current = readAdminLocation(db, "PCB");
    const input = { shopId: "PCB", requestId: "git-change-0001", expectedRevision: current.revision, changes: { managerPhone: "+85291234567" }, reason: "Reviewed demo change" };
    assert.throws(() => applyGitLocationChanges(db, [input, { ...input, shopId: "UNKNOWN", requestId: "git-change-0002" }]), /UNKNOWN_LOCATION/);
    assert.equal(readAdminLocation(db, "PCB").revision, current.revision);
    assert.equal(locationHistory(db, "PCB").length, 0);
    applyGitLocationChanges(db, [input]); applyGitLocationChanges(db, [input]);
    assert.equal(locationHistory(db, "PCB").length, 1);
    assert.equal(browseLocationDirectory(db).locations[0].managerPhone, "+85291234567");
  } finally { db.close(); }
});
