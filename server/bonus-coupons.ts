import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { memberBalance } from "./bonus-store.js";
import { verifiedMemberCode } from "./member-verification.js";
import { lookupCustomer } from "./customer-directory.js";

export function migrateBonusCoupons(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS bonus_coupon_rewards (
    reward_id TEXT PRIMARY KEY, description TEXT NOT NULL, points INTEGER NOT NULL CHECK(points>0),
    amount REAL NOT NULL CHECK(amount>0), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS bonus_coupons (
    request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, member_code TEXT NOT NULL REFERENCES bonus_members(member_code),
    coupon_code TEXT NOT NULL UNIQUE, document TEXT NOT NULL, created_at TEXT NOT NULL);`);
  for (const [points, amount] of [[500, 5], [1000, 12]]) db.prepare(`INSERT INTO bonus_coupon_rewards(reward_id,description,points,amount)
    VALUES(?,?,?,?) ON CONFLICT(reward_id) DO NOTHING`).run(`CASH-${points}`, `Duck Fashion HK$${amount} cash coupon`, points, amount);
}

const inputSchema = z.object({ member: z.string(), phone: z.string(), rewardId: z.string().regex(/^[A-Z0-9_-]{1,80}$/),
  expectedPoints: z.number().int().positive().max(1000000), expectedAmount: z.number().positive(), expectedName: z.string().min(1).max(300), requestId: z.string().regex(/^[A-Za-z0-9:_-]{8,150}$/) }).strict();
export interface BonusCouponReceipt {
  requestId: string; rewardId: string; pointsSpent: number; balanceAfter: number;
  coupon: { br_no: string; statement_desc: string; coupon_amt: number; expiry_date: string; currency: "HKD"; points_spent: number; reward_id: string };
}

/** Trusted CRM supplies the verified sender; the API independently checks exact identity.
 * A durable request key makes a timeout/restart safe to retry, never a second debit. */
export function redeemBonusCoupon(db: DatabaseSync, raw: unknown, now = new Date()): BonusCouponReceipt {
  const data = inputSchema.parse(raw);
  const member = verifiedMemberCode(db, data.member, data.phone);
  const fingerprint = createHash("sha256").update(JSON.stringify([member, data.rewardId, data.expectedPoints, data.expectedAmount, data.expectedName])).digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const prior = db.prepare("SELECT request_hash,document FROM bonus_coupons WHERE request_id=?").get(data.requestId);
    if (prior) {
      if (prior.request_hash !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
      db.exec("COMMIT"); return JSON.parse(prior.document as string);
    }
    const reward = db.prepare(`SELECT item_code id,item_name description,points_needed points,unit_price amount,'item' kind
      FROM bonus_redeemables WHERE active=1 AND item_code=? UNION ALL
      SELECT reward_id id,description,points,amount,'cash' kind FROM bonus_coupon_rewards WHERE active=1 AND reward_id=?`).get(data.rewardId, data.rewardId) as
      { id: string; description: string; points: number; amount: number; kind: string } | undefined;
    if (!reward || reward.points !== data.expectedPoints || reward.amount !== data.expectedAmount || reward.description !== data.expectedName) throw new Error("REWARD_CHANGED");
    const balance = memberBalance(db, member, now);
    if (balance.availablePoints < reward.points) throw new Error("INSUFFICIENT_POINTS");
    let remaining = reward.points;
    for (const period of balance.periods.filter(p => p.status !== "expired" && p.points > 0)) {
      const debit = Math.min(remaining, period.points);
      db.prepare("INSERT INTO bonus_ledger(member_code,period,entry_type,points,trx_date,note) VALUES(?,?,?,?,?,?)")
        .run(member, period.period, reward.kind === "cash" ? "redeem_cash" : "redeem_item", -debit, now.toISOString().slice(0,10), `Coupon ${data.requestId}`);
      remaining -= debit;
      if (!remaining) break;
    }
    if (remaining) throw new Error("INSUFFICIENT_POINTS");
    const coupon = { br_no: `DF-${randomBytes(12).toString("hex").toUpperCase()}`,
      statement_desc: reward.kind === "cash" ? `${reward.description}. Valid in Duck Fashion shops. No cash change.`
        : `Voucher for one ${reward.description} (${reward.id}). Subject to shop stock; no stock is reserved.`,
      coupon_amt: reward.amount, expiry_date: new Date(now.getTime() + 30 * 86400000).toISOString(),
      currency: "HKD" as const, points_spent: reward.points, reward_id: reward.id };
    const result = { requestId: data.requestId, rewardId: reward.id, pointsSpent: reward.points,
      balanceAfter: memberBalance(db, member, now).availablePoints, coupon };
    db.prepare("INSERT INTO bonus_coupons(request_id,request_hash,member_code,coupon_code,document,created_at) VALUES(?,?,?,?,?,?)")
      .run(data.requestId, fingerprint, member, coupon.br_no, JSON.stringify(result), now.toISOString());
    db.exec("COMMIT"); return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** The existing CRM coupon endpoint consumes the same codes/amounts as redemption. */
export function memberCoupons(db: DatabaseSync, phone: unknown) {
  const customers = lookupCustomer(db, phone).customers;
  if (customers.length !== 1) return [];
  return (db.prepare("SELECT document FROM bonus_coupons WHERE member_code=? ORDER BY created_at").all(customers[0].id) as { document: string }[])
    .map(row => ({ ...JSON.parse(row.document).coupon, mbr_code: customers[0].id }));
}
