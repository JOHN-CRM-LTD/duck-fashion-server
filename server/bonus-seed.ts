// Seeds the Duck Fashion member-bonus tables into the capsule SQLite database.
// Idempotent: run it any time; existing member/ledger rows are left untouched.
//   npm run seed:bonus            (duck-fashion-server)
//   npm run duck:seed-bonus       (johncrm repo)
//
// Real customer records never enter Git (see CUSTOMER-MATCHING.md): this
// public repo carries only a synthetic roster for fresh clones and CI, while
// live machines keep the roster imported through the staff write endpoint.
// The demo ledger below is inserted per member code that exists in the
// database, so the same seed serves both worlds — synthetic members on a
// fresh clone, the real imported members on the Pi.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bonusRedeemableSeed } from "./bonus-store.js";

// Synthetic roster (fictional +852 6123 45xx numbers, matching the examples
// in CUSTOMER-MATCHING.md). On a live machine these rows already exist with
// real details and the ON CONFLICT clause leaves them untouched.
const members = [
  { member_code: "DF1005", name: "Example member five", name_zh: "示例會員五", grade: "Gold Feather", mobile: "+852 6123 4505", joined_on: "2024-11-09" },
  { member_code: "DF1006", name: "Example member six", name_zh: "示例會員六", grade: "Silver Feather", mobile: "+852 6123 4506", joined_on: "2025-06-21" },
  { member_code: "DF1007", name: "Example member seven", name_zh: "示例會員七", grade: "Duckling", mobile: "+852 6123 4507", joined_on: "2026-08-14" },
  { member_code: "DF1008", name: "Example member eight", name_zh: null, grade: "Bronze Feather", mobile: "+852 6123 4508", joined_on: "2025-10-02" },
  { member_code: "DF1009", name: "Example member nine", name_zh: null, grade: "Gold Feather", mobile: "+852 6123 4509", joined_on: "2023-07-30" },
  { member_code: "DF1010", name: "Example member ten", name_zh: null, grade: "Silver Feather", mobile: "+852 6123 4510", joined_on: "2025-03-15" },
  { member_code: "DF-DEMO-AU", name: "Chat demo customer AU", name_zh: null, grade: "Duckling", mobile: "+852 6123 4591", joined_on: "2026-09-18" },
  { member_code: "DF-DEMO-HK", name: "Chat demo customer HK", name_zh: null, grade: "Duckling", mobile: "+852 6123 4592", joined_on: "2026-09-18" },
];
// The fictional +852 9123 000X series is retired; the seed removes those
// members and their history wherever they were imported earlier.
const retiredMembers = ["DF1001", "DF1002", "DF1003", "DF1004"];
const periods = [
  // 2026A expires soon (Oct 31) so the demo always shows an expiry warning today.
  { period: "2026A", earn_from: "2026-01-01", earn_to: "2026-06-30", expires_on: "2026-10-31" },
  { period: "2026B", earn_from: "2026-07-01", earn_to: "2026-12-31", expires_on: "2027-04-30" },
];
const ledger = [
  { member_code: "DF1005", period: "2026A", entry_type: "earn", points: 900, trx_date: "2026-04-11", note: "Overshirt + cap" },
  { member_code: "DF1005", period: "2026B", entry_type: "earn", points: 460, trx_date: "2026-08-03", note: "Graphic tee" },
  { member_code: "DF1006", period: "2026A", entry_type: "earn", points: 520, trx_date: "2026-03-08", note: "Cargo trousers" },
  { member_code: "DF1006", period: "2026A", entry_type: "redeem_item", points: -100, trx_date: "2026-06-20", note: "Beanie partial redemption" },
  { member_code: "DF1006", period: "2026B", entry_type: "earn", points: 380, trx_date: "2026-07-27", note: "Jersey shorts" },
  { member_code: "DF1007", period: "2026B", entry_type: "earn", points: 150, trx_date: "2026-08-15", note: "First purchase welcome" },
  { member_code: "DF1008", period: "2026A", entry_type: "earn", points: 610, trx_date: "2026-05-30", note: "Sweatshirt" },
  { member_code: "DF1009", period: "2026A", entry_type: "earn", points: 2600, trx_date: "2026-02-14", note: "Full winter set" },
  { member_code: "DF1009", period: "2026A", entry_type: "redeem_cash", points: -500, trx_date: "2026-06-30", note: "Converted to $5 store cash" },
  { member_code: "DF1009", period: "2026B", entry_type: "earn", points: 540, trx_date: "2026-09-06", note: "Hoodie" },
  { member_code: "DF1010", period: "2026B", entry_type: "earn", points: 720, trx_date: "2026-07-19", note: "Visit pickup: hoodie + tee" },
  // The two chat-demo customers: AU stays short of the cheapest redeemable,
  // HK lands in the expiring-soon window.
  { member_code: "DF-DEMO-AU", period: "2026B", entry_type: "earn", points: 260, trx_date: "2026-09-17", note: "Demo purchase: cap + tee" },
  { member_code: "DF-DEMO-HK", period: "2026A", entry_type: "earn", points: 150, trx_date: "2026-05-12", note: "First demo purchase" },
];
const tiers = [
  { min_points: 100, cash_value: 1 },
  { min_points: 500, cash_value: 5 },
  { min_points: 1000, cash_value: 12 },
];
// One premium redeemable outside the capsule price list so the demo also shows
// the "not enough points yet" answer for a Gold-tier member.
const extraRedeemables = [
  { item_code: "GIFT-DF01", item_name: "Duck Fashion Gold Feather Gift Box", unit_price: 799, points_needed: 2000 },
];

export function seedBonus(db: DatabaseSync) {
  db.exec(`
CREATE TABLE IF NOT EXISTS bonus_members(member_code TEXT PRIMARY KEY,name TEXT NOT NULL,name_zh TEXT,grade TEXT NOT NULL CHECK(grade IN ('Duckling','Bronze Feather','Silver Feather','Gold Feather')),mobile TEXT,joined_on TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bonus_periods(period TEXT PRIMARY KEY,earn_from TEXT NOT NULL,earn_to TEXT NOT NULL,expires_on TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bonus_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,member_code TEXT NOT NULL REFERENCES bonus_members(member_code),period TEXT NOT NULL REFERENCES bonus_periods(period),entry_type TEXT NOT NULL CHECK(entry_type IN ('earn','redeem_item','redeem_cash','adjust')),points INTEGER NOT NULL,trx_date TEXT NOT NULL,note TEXT);
CREATE TABLE IF NOT EXISTS bonus_redeemables(item_code TEXT PRIMARY KEY,item_name TEXT NOT NULL,unit_price REAL NOT NULL,points_needed INTEGER NOT NULL CHECK(points_needed > 0),active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bonus_cash_tiers(min_points INTEGER PRIMARY KEY,cash_value REAL NOT NULL CHECK(cash_value > 0));
`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const code of retiredMembers) {
      db.prepare("DELETE FROM bonus_ledger WHERE member_code = ?").run(code);
      db.prepare("DELETE FROM bonus_members WHERE member_code = ?").run(code);
    }
    for (const period of periods) db.prepare("INSERT INTO bonus_periods(period,earn_from,earn_to,expires_on) VALUES(?,?,?,?) ON CONFLICT(period) DO NOTHING").run(period.period, period.earn_from, period.earn_to, period.expires_on);
    // The synthetic roster boots a fresh database only. A live machine's
    // imported roster stays authoritative and is never merged or replaced.
    const rosterCount = (db.prepare("SELECT COUNT(*) n FROM bonus_members").get() as { n: number }).n;
    if (rosterCount === 0) for (const member of members) db.prepare("INSERT INTO bonus_members(member_code,name,name_zh,grade,mobile,joined_on) VALUES(?,?,?,?,?,?) ON CONFLICT(member_code) DO NOTHING").run(member.member_code, member.name, member.name_zh, member.grade, member.mobile, member.joined_on);
    // Demo history is only written for member codes that exist in this
    // database, so a live machine's imported roster drives what resolves and
    // the foreign keys on bonus_ledger always hold.
    const present = new Set((db.prepare("SELECT member_code code FROM bonus_members").all() as unknown as { code: string }[]).map(row => row.code));
    // Per-entry idempotency: re-running on an already-seeded database adds
    // only new demo rows and never duplicates or resets existing history.
    const insertLedger = db.prepare("INSERT INTO bonus_ledger(member_code,period,entry_type,points,trx_date,note) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM bonus_ledger WHERE member_code=? AND trx_date=? AND entry_type=? AND points=? AND note IS ?)");
    for (const entry of ledger.filter(entry => present.has(entry.member_code))) insertLedger.run(entry.member_code, entry.period, entry.entry_type, entry.points, entry.trx_date, entry.note, entry.member_code, entry.trx_date, entry.entry_type, entry.points, entry.note);
    for (const item of [...bonusRedeemableSeed, ...extraRedeemables]) db.prepare("INSERT INTO bonus_redeemables(item_code,item_name,unit_price,points_needed) VALUES(?,?,?,?) ON CONFLICT(item_code) DO UPDATE SET item_name=excluded.item_name,unit_price=excluded.unit_price,points_needed=excluded.points_needed").run(item.item_code, item.item_name, item.unit_price, item.points_needed);
    for (const tier of tiers) db.prepare("INSERT INTO bonus_cash_tiers(min_points,cash_value) VALUES(?,?) ON CONFLICT(min_points) DO NOTHING").run(tier.min_points, tier.cash_value);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return db.prepare("SELECT (SELECT COUNT(*) FROM bonus_members) members,(SELECT COUNT(*) FROM bonus_ledger) ledger,(SELECT COUNT(*) FROM bonus_redeemables) redeemables,(SELECT COUNT(*) FROM bonus_cash_tiers) tiers").get() as { members: number; ledger: number; redeemables: number; tiers: number };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const configPath = resolve(".local-duck/live-connection.json");
  const config = JSON.parse(existsSync(configPath) ? readFileSync(configPath, "utf8") : "{}");
  const directory = process.argv[2] ?? config.dataDirectory;
  if (!directory) throw new Error("Pass the data directory: npm run seed:bonus -- <path> (or set dataDirectory in .local-duck/live-connection.json)");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "duck-fashion.sqlite"));
  const summary = seedBonus(db);
  db.close();
  console.log(JSON.stringify({ seeded: true, database: join(directory, "duck-fashion.sqlite"), ...summary }, null, 2));
}
