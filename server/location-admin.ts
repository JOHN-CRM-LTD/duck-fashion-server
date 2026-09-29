import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sourceLocationSchema } from "./location-contract.js";

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/).nullable();
// Stable source IDs cannot be edited. Parse the merged record too, so hours,
// coordinates and every existing location constraint still apply.
export const locationChangesSchema = sourceLocationSchema.innerType()
  .omit({ id: true, inventoryLocationId: true }).partial()
  .extend({ phone: phone.optional(), managerPhone: phone.optional() }).strict()
  .refine(row => Object.keys(row).length > 0, "Provide at least one field");
export const locationUpdateSchema = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,99}$/),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  changes: locationChangesSchema,
  reason: z.string().trim().min(3).max(300),
}).strict();
export const gitLocationChangesSchema = z.array(locationUpdateSchema.extend({
  shopId: z.string().trim().min(1).max(160),
})).max(1000);

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function migrateLocationAdmin(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS location_changes (
    request_id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    before_document TEXT NOT NULL, after_document TEXT NOT NULL,
    reason TEXT NOT NULL, changed_at TEXT NOT NULL
  )`);
}
export function readAdminLocation(db: DatabaseSync, shopId: string) {
  const row = db.prepare("SELECT document FROM shop_locations WHERE inventory_location_id=?").get(shopId);
  if (!row) throw new Error("UNKNOWN_LOCATION");
  const document = String(row.document);
  return { location: sourceLocationSchema.parse(JSON.parse(document)), revision: hash(document) };
}
function updateInsideTransaction(db: DatabaseSync, shopId: string, raw: unknown) {
  const input = locationUpdateSchema.parse(raw);
  const requestHash = hash(JSON.stringify({ shopId, ...input }));
  const prior = db.prepare("SELECT request_hash,after_document FROM location_changes WHERE request_id=?").get(input.requestId);
  if (prior) {
    if (prior.request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
    return { location: JSON.parse(String(prior.after_document)), revision: hash(String(prior.after_document)), replayed: true };
  }
  const current = readAdminLocation(db, shopId);
  if (current.revision !== input.expectedRevision) throw new Error("LOCATION_CONFLICT");
  const location = sourceLocationSchema.parse({ ...current.location, ...input.changes });
  if (location.isDefault && db.prepare("SELECT document FROM shop_locations WHERE inventory_location_id<>?").all(shopId)
    .some(row => JSON.parse(String(row.document)).isDefault)) throw new Error("MULTIPLE_DEFAULT_LOCATIONS");
  const before = String(db.prepare("SELECT document FROM shop_locations WHERE inventory_location_id=?").get(shopId)!.document);
  const after = JSON.stringify(location);
  db.prepare("UPDATE shop_locations SET document=? WHERE inventory_location_id=?").run(after, shopId);
  // Public stock shop names and staff location names now stay consistent.
  if (input.changes.name !== undefined) db.prepare("UPDATE shops SET name=? WHERE id=?").run(location.name, shopId);
  db.prepare("INSERT INTO location_changes VALUES (?,?,?,?,?,?,?)").run(input.requestId, shopId, requestHash, before, after, input.reason, new Date().toISOString());
  return { location, revision: hash(after), replayed: false };
}
export function updateAdminLocation(db: DatabaseSync, shopId: string, input: unknown) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = updateInsideTransaction(db, shopId, input); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function applyGitLocationChanges(db: DatabaseSync, raw: unknown) {
  const changes = gitLocationChangesSchema.parse(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { shopId, ...change } of changes) updateInsideTransaction(db, shopId, change);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function locationHistory(db: DatabaseSync, shopId: string) {
  return db.prepare("SELECT request_id AS requestId,reason,changed_at AS changedAt,before_document,after_document FROM location_changes WHERE shop_id=? ORDER BY rowid DESC LIMIT 50").all(shopId)
    .map(({ before_document, after_document, ...row }) => ({ ...row, before: JSON.parse(String(before_document)), after: JSON.parse(String(after_document)), revision: hash(String(after_document)) }));
}
