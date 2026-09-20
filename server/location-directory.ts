import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { sourceLocationSchema, LOCATION_PAGE_SIZE } from "./location-contract.js";

/** Customer-owned storage only. Never automatically replace an existing shop. */
export function migrateLocationDirectory(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS shop_locations (
    id INTEGER PRIMARY KEY, inventory_location_id TEXT NOT NULL UNIQUE REFERENCES shops(id),
    document TEXT NOT NULL
  )`);
}

/** Operator-side migration, deliberately not exposed to the CRM read credential. */
export function importLocationDirectory(db: DatabaseSync, input: unknown) {
  if (!Array.isArray(input) || input.length > 5000) throw new Error("INVALID_LOCATION_IMPORT");
  const rows = input.map(row => sourceLocationSchema.parse(row));
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.inventoryLocationId)).size !== rows.length) throw new Error("DUPLICATE_LOCATION_ID");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const existing = db.prepare("SELECT id, document FROM shop_locations WHERE id=? OR inventory_location_id=?").all(row.id, row.inventoryLocationId);
      if (existing.length) {
        if (existing.length !== 1 || existing[0].id !== row.id || existing[0].document !== JSON.stringify(row)) throw new Error("LOCATION_ALREADY_EXISTS");
        continue;
      }
      db.prepare("INSERT INTO shop_locations (id,inventory_location_id,document) VALUES (?,?,?)").run(row.id, row.inventoryLocationId, JSON.stringify(row));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { imported: rows.length };
}
export function browseLocationDirectory(db: DatabaseSync, rawOffset: unknown, rawLimit: unknown) {
  const offset = rawOffset === undefined ? 0 : Number(rawOffset), limit = rawLimit === undefined ? LOCATION_PAGE_SIZE : Number(rawLimit);
  if (typeof rawOffset === "object" || typeof rawLimit === "object" || !Number.isSafeInteger(offset) || offset < 0 || offset > 5000 || !Number.isSafeInteger(limit) || limit < 1 || limit > LOCATION_PAGE_SIZE) throw new Error("INVALID_LOCATION_PAGE");
  // A missing import is not an empty enterprise directory. It must not hide shops.
  const missing = db.prepare("SELECT s.id FROM shops s LEFT JOIN shop_locations l ON l.inventory_location_id=s.id WHERE l.id IS NULL LIMIT 1").get();
  if (missing) throw new Error("LOCATION_DIRECTORY_INCOMPLETE");
  // One SQLite read defines both the page and its snapshot fingerprint.
  const all = db.prepare("SELECT document FROM shop_locations ORDER BY id LIMIT 5001").all();
  if (all.length > 5000) throw new Error("LOCATION_DIRECTORY_TOO_LARGE");
  const revision = createHash("sha256").update(JSON.stringify(all)).digest("hex");
  return { locations: all.slice(offset, offset + limit).map(row => sourceLocationSchema.parse(JSON.parse(String(row.document)))), hasMore: all.length > offset + limit, revision };
}
