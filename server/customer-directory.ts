import type { DatabaseSync } from "node:sqlite";

const normalizedMobile = "replace(replace(replace(replace(replace(replace(mobile,' ',''),'+',''),'-',''),'(',''),')',''),'.','')";
/** The bonus system's member table is the single source of customer identity. */
export function migrateCustomerDirectory(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS bonus_members(member_code TEXT PRIMARY KEY,name TEXT NOT NULL,name_zh TEXT,grade TEXT NOT NULL CHECK(grade IN ('Duckling','Bronze Feather','Silver Feather','Gold Feather')),mobile TEXT,joined_on TEXT NOT NULL)");
    // Do not silently merge people or change existing balances if source data is ambiguous.
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS bonus_members_unique_mobile ON bonus_members(${normalizedMobile}) WHERE mobile IS NOT NULL AND ${normalizedMobile} <> ''`);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
/** Explicit staff import only. Never called by inbound chat or lookup. */
export function importCustomers(db: DatabaseSync, value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error("INVALID_CUSTOMERS");
  const seenIds = new Set<string>(), seenPhones = new Set<string>();
  const rows = value.map(row => {
    const phone = internationalPhone(row?.phone);
    if (!row || typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) || typeof row.name !== "string"
      || !row.name.trim() || row.name.length > 160 || !phone || seenIds.has(row.id) || seenPhones.has(phone)) throw new Error("INVALID_CUSTOMERS");
    seenIds.add(row.id); seenPhones.add(phone);
    if (row.grade !== undefined && !["Duckling", "Bronze Feather", "Silver Feather", "Gold Feather"].includes(row.grade)
      || row.nameZh !== undefined && row.nameZh !== null && (typeof row.nameZh !== "string" || row.nameZh.length > 160)
      || row.joinedOn !== undefined && (typeof row.joinedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.joinedOn))) throw new Error("INVALID_CUSTOMERS");
    return { id: row.id, name: row.name.trim(), phone, nameZh: row.nameZh ?? null, grade: row.grade ?? "Duckling", joinedOn: row.joinedOn ?? new Date().toISOString().slice(0, 10) };
  });
  db.exec("BEGIN IMMEDIATE");
  try {
    // Existing member metadata and all bonus ledger entries are preserved.
    const put = db.prepare("INSERT INTO bonus_members(member_code,name,mobile,name_zh,grade,joined_on) VALUES(?,?,?,?,?,?) ON CONFLICT(member_code) DO UPDATE SET name=excluded.name,mobile=excluded.mobile");
    for (const row of rows) {
      const owners = lookupCustomer(db, row.phone).customers;
      if (owners.some(owner => owner.id !== row.id)) throw new Error("CUSTOMER_PHONE_CONFLICT");
      put.run(row.id, row.name, row.phone, row.nameZh, row.grade, row.joinedOn);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { imported: rows.length };
}
function internationalPhone(value: unknown): string | null {
  if (typeof value !== "string" || !/^[+\d\s().-]{7,40}$/.test(value)) return null;
  const digits = value.replace(/[+\s().-]/g, "");
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}
/** Exact lookup only: no phone suffixes, name search, pagination or whole-directory exposure. */
export function lookupCustomer(db: DatabaseSync, rawPhone: unknown) {
  const phone = internationalPhone(rawPhone);
  if (!phone) throw new Error("INVALID_CUSTOMER_PHONE");
  const rows = db.prepare(`SELECT member_code id,name,mobile phone FROM bonus_members WHERE ${normalizedMobile}=? LIMIT 2`)
    .all(phone.slice(1)) as { id: string; name: string; phone: string }[];
  // Return both on ambiguity so CRM refuses to assign either identity.
  return { customers: rows.map(row => ({ ...row, phone: internationalPhone(row.phone) })), complete: true };
}
