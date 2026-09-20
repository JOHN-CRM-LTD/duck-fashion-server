import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { capsuleTokens } from "./capsule-catalog.js";
import { browseCustomers, importCustomers, lookupCustomer, migrateCustomerDirectory } from "./customer-directory.js";
import { bonusBalance, bonusRedeemables, bonusCashScheme } from "./bonus-store.js";
import { seedBonus } from "./bonus-seed.js";
import { verifiedMemberCode } from "./member-verification.js";

export const capsuleAdjustment = z.object({ sku: z.string().regex(/^DF0[1-8]-(BUR|CRM|BLK)-(S|M|L)$/), locationId: z.enum(["PCL", "PCB", "SH015"]), delta: z.number().int().min(-1000).max(1000).refine(n => n !== 0), expectedVersion: z.number().int().min(1).max(2147483646), reason: z.string().trim().min(3).max(300), requestId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,99}$/) }).strict();

export function openCapsule(directory: string, publicUrl: string) {
  const baseUrl = new URL(publicUrl);
  if (!["https:", "http:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("Public API URL must be an HTTP(S) base URL without credentials, query or fragment");
  }
  // Keep a reverse proxy's path prefix when constructing public photo links.
  const publicBase = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, "")}`;
  const path = join(directory, "duck-fashion.sqlite");
  if (!existsSync(path)) throw new Error("Seed the capsule database first");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  migrateCustomerDirectory(db);
  // Seed the member-bonus demo tables on boot so a code-only deploy on the Pi
  // brings the loyalty endpoints up without a manual step. seedBonus is
  // idempotent and transactional: it only inserts missing demo rows and never
  // resets an existing ledger, so live redemptions survive restarts.
  seedBonus(db);
  const decorate = (document: string) => {
    const p = JSON.parse(document);
    return { ...p, images: (p.images ?? []).map((photo: any)=>({...photo,imageUrl:`${publicBase}/images/${photo.imageFile}`})), imageUrl: p.imageFile ? `${publicBase}/images/${p.imageFile}` : null, productUrl: p.imageFile ? `${publicBase}/images/${p.imageFile}` : null };
  };
  const search = (query: string, limit = 30, offset = 0) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000) throw new Error("INVALID_QUERY");
    const tokens = capsuleTokens(query);
    const rows = db.prepare("SELECT document,search_text FROM variants ORDER BY style_code,CASE color WHEN 'Duck Burgundy' THEN 0 WHEN 'Chalk Cream' THEN 1 ELSE 2 END,CASE size WHEN 'S' THEN 0 WHEN 'M' THEN 1 ELSE 2 END").all() as { document: string; search_text: string }[];
    const found = rows.filter(row => tokens.every(t => /^[a-z0-9]+$/.test(t) ? ` ${row.search_text} `.includes(` ${t} `) : row.search_text.includes(t)));
    return { products: found.slice(offset, offset + limit).map(row => decorate(row.document)), total: found.length, offset, hasMore: offset + limit < found.length };
  };
  return {
    close: () => db.close(),
    customerLookup: (phone: unknown) => lookupCustomer(db, phone),
    customerBrowse: (input: Parameters<typeof browseCustomers>[1]) => browseCustomers(db, input),
    importCustomers: (rows: unknown) => importCustomers(db, rows),
    // Member bonus points (seeded by bonus-seed.ts into the same database).
    bonusBalance: (reference: string) => bonusBalance(db, reference),
    verifiedBonusBalance: (member: unknown, phone: unknown) => bonusBalance(db, verifiedMemberCode(db, member, phone)),
    verifiedBonusRedeemables: (member: unknown, phone: unknown) => bonusRedeemables(db, verifiedMemberCode(db, member, phone)),
    bonusRedeemables: (reference?: string) => bonusRedeemables(db, reference),
    bonusCashScheme: () => bonusCashScheme(db),
    products(query: string, offset = 0) {
      // Product browsing is style-based so the complete eight-item range fits in
      // one customer response. Inventory stays variant-based for reservations.
      const found = search(query, 72);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000) throw new Error("INVALID_QUERY");
      const groups = new Map<string, any>();
      for (const p of found.products) {
        if (!groups.has(p.styleCode)) {
          const { sku: _sku, color: _color, colorCode: _cc, colorHex: _ch, size: _size, sizeCode: _sc, variant: _variant, ...shared } = p;
          groups.set(p.styleCode, { ...shared, id: p.styleCode, colors: [], sizes: [], variants: [] });
        }
        const group = groups.get(p.styleCode);
        if (!group.colors.includes(p.color)) group.colors.push(p.color);
        if (!group.sizes.includes(p.size)) group.sizes.push(p.size);
        group.variants.push({ sku: p.sku, color: p.color, size: p.size, variant: p.variant });
      }
      return { items: [...groups.values()].slice(offset,offset+8), total: groups.size, offset, hasMore: offset+8<groups.size, demo: true };
    },
    inventory(query: string) {
      const found = search(query, 72);
      const stock = db.prepare("SELECT s.location_id locationId,s.quantity,s.revision stockVersion,h.name shopName FROM stock s JOIN shops h ON h.id=s.location_id WHERE s.sku=? ORDER BY s.location_id");
      // A whole-catalogue matrix stays below the integration's 64 KB output cap.
      // Photos are fetched on an individual item search, not repeated 216 times.
      return { items: found.products.flatMap(p => stock.all(p.sku).map(s => ({ id: p.sku, name: p.name, variant: p.variant, quantity: s.quantity, locationId: s.locationId, stockVersion: s.stockVersion, imageUrl: found.total <= 9 ? p.imageUrl : null }))), totalProducts: found.total, hasMore: found.hasMore, stockMode: "snapshot", demo: true,
        guidance: "Fictional eight-style Duck Fashion demo; prices, materials, size guides and stock are demo values. Photos show the stated photoColor only, not every colour. Use native search_shop_inventory and reservation tools to deduct CRM holds/completed sales. Confirm exact size, colour, shop and future arrival time before requesting manager approval." + (found.hasMore ? " Narrow the search by item, size and colour to see all matching stock." : "") };
    },
    shops() { return { shops: db.prepare("SELECT id,name FROM shops ORDER BY id").all(), guidance: "Use John CRM shop settings for current hours, address, manager and pickup rules." }; },
    adjust(value: unknown) {
      const data = capsuleAdjustment.parse(value);
      const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        const prior = db.prepare("SELECT request_hash,document FROM stock_changes WHERE request_id=?").get(data.requestId);
        if (prior) {
          if (prior.request_hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
          db.exec("COMMIT"); return { adjustment: JSON.parse(prior.document as string) };
        }
        const current = db.prepare("SELECT quantity,revision FROM stock WHERE sku=? AND location_id=?").get(data.sku, data.locationId) as { quantity: number; revision: number } | undefined;
        if (!current) throw new Error("UNKNOWN_STOCK");
        if (current.revision !== data.expectedVersion) throw new Error("STOCK_CONFLICT");
        const quantity = current.quantity + data.delta;
        if (quantity < 0 || quantity > 1000000) throw new Error("INVALID_STOCK");
        const adjustment = { ...data, quantityBefore: current.quantity, quantityAfter: quantity, stockVersion: current.revision + 1, createdAt: new Date().toISOString() };
        db.prepare("UPDATE stock SET quantity=?,revision=revision+1 WHERE sku=? AND location_id=?").run(quantity, data.sku, data.locationId);
        db.prepare("INSERT INTO stock_changes(request_id,request_hash,document) VALUES(?,?,?)").run(data.requestId, hash, JSON.stringify(adjustment));
        db.exec("COMMIT"); return { adjustment };
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
}
