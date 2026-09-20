import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateLocationDirectory, importLocationDirectory, browseLocationDirectory } from "./location-directory.js";

test("Duck owns 300 paginated locations; repeat import preserves source and conflicts roll back", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT NOT NULL)");
    migrateLocationDirectory(db);
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, inventoryLocationId: `S${i + 1}`, name: `Shop ${i + 1}`, country: "HK", timezone: "Asia/Hong_Kong", hours: {}, isActive: true }));
    for (const row of rows) db.prepare("INSERT INTO shops VALUES (?,?)").run(row.inventoryLocationId, row.name);
    assert.throws(() => browseLocationDirectory(db, 0, 50), /INCOMPLETE/);
    importLocationDirectory(db, rows); importLocationDirectory(db, rows);
    assert.equal(browseLocationDirectory(db, 0, 50).locations.length, 50);
    assert.equal(browseLocationDirectory(db, 250, 50).hasMore, false);
    assert.equal(browseLocationDirectory(db, 250, 50).locations[49].id, 300);
    assert.throws(() => importLocationDirectory(db, [{ ...rows[0], name: "Changed" }]), /ALREADY_EXISTS/);
    assert.equal(browseLocationDirectory(db, 0, 50).locations[0].name, "Shop 1");
    assert.throws(() => browseLocationDirectory(db, -1, 50), /INVALID/);
    assert.throws(() => browseLocationDirectory(db, 0, 51), /INVALID/);
  } finally { db.close(); }
});
