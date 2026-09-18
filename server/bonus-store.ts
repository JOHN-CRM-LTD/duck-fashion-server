// Duck Fashion member bonus points — a deliberately small loyalty demo modelled
// on the SportElements_8 bonus section (bonus balance, redeemable items and the
// Bonus-as-Cash scheme) but sized for the eight-item capsule. Balances are
// always derived from the ledger so the demo can never disagree with itself.
import type { DatabaseSync } from "node:sqlite";
import { capsuleItems } from "./capsule-catalog.js";

export const BONUS_GRADES = ["Duckling", "Bronze Feather", "Silver Feather", "Gold Feather"] as const;

type LedgerRow = { period: string; points: number; expires_on: string };

const digits = (value: string) => value.replace(/[^\d]/g, "");
const daysUntil = (isoDate: string, now: Date) => Math.ceil((Date.parse(`${isoDate}T23:59:59`) - now.getTime()) / 86400000);

export function findBonusMember(db: DatabaseSync, reference: string) {
  const ref = reference.trim();
  if (!ref || ref.length > 120) throw new Error("INVALID_MEMBER");
  type Member = { code: string; name: string; nameZh: string | null; grade: string; mobile: string | null };
  const byCode = db.prepare("SELECT member_code code, name, name_zh nameZh, grade, mobile FROM bonus_members WHERE member_code = ? COLLATE NOCASE").get(ref);
  if (byCode) return { match: byCode as Member };
  // Mobile matching in JS: digit-stripped equality, then the last 8 digits so
  // "+852 6123 4505", "85261234505" and "61234505" all find the same member.
  const refDigits = digits(ref);
  if (refDigits.length >= 8) {
    const everyone = db.prepare("SELECT member_code code, name, name_zh nameZh, grade, mobile FROM bonus_members").all() as unknown as Member[];
    const normalized = everyone.filter(m => m.mobile && digits(m.mobile).length >= 8).map(m => ({ member: m, digits: digits(m.mobile!) }));
    const exact = normalized.find(m => m.digits === refDigits);
    if (exact) return { match: exact.member };
    const tail = normalized.filter(m => m.digits.slice(-8) === refDigits.slice(-8));
    if (tail.length === 1) return { match: tail[0].member };
    if (tail.length > 1) throw Object.assign(new Error("AMBIGUOUS_MEMBER"), { candidates: tail.map(t => t.member) });
  }
  const byName = db.prepare("SELECT member_code code, name, name_zh nameZh, grade, mobile FROM bonus_members WHERE name = ? COLLATE NOCASE OR name_zh = ? COLLATE NOCASE").all(ref, ref) as unknown as Member[];
  if (byName.length === 1) return { match: byName[0] };
  const partial = db.prepare("SELECT member_code code, name, name_zh nameZh, grade, mobile FROM bonus_members WHERE name LIKE ? COLLATE NOCASE OR name_zh LIKE ? COLLATE NOCASE").all(`%${ref}%`, `%${ref}%`) as unknown as Member[];
  const candidates = [...new Map([...byName, ...partial].map(m => [m.code, m])).values()];
  if (candidates.length > 1) throw Object.assign(new Error("AMBIGUOUS_MEMBER"), { candidates });
  if (candidates.length === 1) return { match: candidates[0] };
  return { match: null };
}

function memberBalance(db: DatabaseSync, code: string, now: Date) {
  const rows = db.prepare("SELECT l.period, SUM(l.points) points, p.expires_on FROM bonus_ledger l JOIN bonus_periods p ON p.period = l.period WHERE l.member_code = ? GROUP BY l.period, p.expires_on ORDER BY p.expires_on").all(code) as LedgerRow[];
  let availablePoints = 0;
  const periods = rows.map(row => {
    const days = daysUntil(row.expires_on, now);
    const status = days < 0 ? "expired" : days <= 60 ? "expiring_soon" : "active";
    if (days >= 0) availablePoints += Number(row.points);
    return { period: row.period, points: Number(row.points), expiresOn: row.expires_on, status };
  });
  const soonest = periods.filter(p => p.status !== "expired" && p.points !== 0).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
  return { availablePoints, periods, expiringSoon: soonest?.status === "expiring_soon" ? { date: soonest.expiresOn, points: soonest.points, daysRemaining: daysUntil(soonest.expiresOn, now) } : null };
}

function publicMember(member: { code: string; name: string; nameZh: string | null; grade: string; mobile: string | null }) {
  return { memberCode: member.code, memberName: member.name, memberNameZh: member.nameZh, grade: member.grade };
}

export function bonusBalance(db: DatabaseSync, reference: string, now = new Date()) {
  const { match } = findBonusMember(db, reference);
  if (!match) throw new Error("UNKNOWN_MEMBER");
  const balance = memberBalance(db, match.code, now);
  const lastActivityOn = (db.prepare("SELECT MAX(trx_date) last FROM bonus_ledger WHERE member_code = ?").get(match.code) as { last: string | null }).last;
  return {
    member: publicMember(match),
    availablePoints: balance.availablePoints,
    expiringSoon: balance.expiringSoon,
    periods: balance.periods,
    lastActivityOn,
    checkedAt: now.toISOString(),
    guidance: "Show the member name and grade as a loyalty tier, the available points as the headline number, and warn about the expiry date when expiringSoon is present so points are not forfeited. Only the returned points are real; never estimate or invent a balance.",
  };
}

export function bonusRedeemables(db: DatabaseSync, reference: string | undefined, now = new Date()) {
  let availablePoints: number | null = null;
  let member = null as ReturnType<typeof publicMember> | null;
  if (reference !== undefined && reference !== "") {
    const { match } = findBonusMember(db, reference);
    if (!match) throw new Error("UNKNOWN_MEMBER");
    member = publicMember(match);
    availablePoints = memberBalance(db, match.code, now).availablePoints;
  }
  const items = (db.prepare("SELECT item_code, item_name, unit_price, points_needed FROM bonus_redeemables WHERE active = 1 ORDER BY points_needed, item_code").all() as { item_code: string; item_name: string; unit_price: number; points_needed: number }[])
    .map(row => ({ itemCode: row.item_code, itemName: row.item_name, unitPrice: Number(row.unit_price), pointsNeeded: Number(row.points_needed), affordable: availablePoints == null ? null : availablePoints >= Number(row.points_needed) }));
  return {
    member,
    availablePoints,
    items,
    checkedAt: now.toISOString(),
    guidance: "List each item with its name, code and the bonus points needed. When a member balance is present, say clearly which items they can already afford and how many more points the others need. Points-needed values are exact; do not invent items or prices.",
  };
}

export function bonusCashScheme(db: DatabaseSync, now = new Date()) {
  const tiers = (db.prepare("SELECT min_points, cash_value FROM bonus_cash_tiers ORDER BY min_points").all() as { min_points: number; cash_value: number }[])
    .map(row => ({ minPoints: Number(row.min_points), cashValue: Number(row.cash_value) }));
  const base = tiers[0];
  return {
    scheme: {
      name: "Duck Fashion Bonus-as-Cash",
      baseRatio: base ? { points: base.minPoints, cash: base.cashValue } : null,
      tiers,
      howItWorks: "Members convert bonus points into store cash at a tiered rate: the highest tier their chosen point amount reaches sets the value. Converted cash is deducted from the bonus balance immediately and can only be spent in Duck Fashion shops.",
    },
    checkedAt: now.toISOString(),
    guidance: "Explain the base ratio first (for example 100 PTS = $1.00), then the tier table. If the caller supplies a point amount, compute the cash by picking the highest tier whose minPoints does not exceed that amount; amounts below the smallest tier cannot be converted. Do not invent tiers or rates.",
  };
}

// The redeemable catalogue mirrors the capsule styles so the demo stays coherent
// with stock and photos. Points are roughly 2.5× the HKD price.
export const bonusRedeemableSeed = capsuleItems.map(item => ({ item_code: item.code, item_name: item.name, unit_price: item.price, points_needed: Math.round(item.price * 2.5 / 10) * 10 }));
