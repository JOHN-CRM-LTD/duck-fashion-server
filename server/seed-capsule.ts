// Recreates the SQLite capsule database from data/catalog.json so a fresh
// clone can boot without the laptop's original seed bundle. The live
// data/duck-fashion.sqlite is gitignored on purpose (it holds real stock
// adjustments), which is why this script exists.
//
//   npm run seed              create data/duck-fashion.sqlite if missing
//   npm run seed -- --force   rebuild it from the catalogue (drops live stock changes)
//   npm run seed -- --data /tmp/ci-data   write the database somewhere else
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capsuleWords } from "./capsule-catalog.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const dataFlagAt = args.indexOf("--data");
const dataDirectory = dataFlagAt !== -1 && args[dataFlagAt + 1] ? resolve(args[dataFlagAt + 1]) : join(root, "data");
const dbPath = join(dataDirectory, "duck-fashion.sqlite");

const catalog = JSON.parse(readFileSync(join(root, "data", "catalog.json"), "utf8")) as {
  products: any[];
  variants: any[];
  shops: { id: string; name: string }[];
  initialStock: { sku: string; locationId: string; quantity: number; revision?: number }[];
};

if (existsSync(dbPath)) {
  if (!force) {
    console.log(`${dbPath} already exists — nothing to do (use --force to rebuild).`);
    process.exit(0);
  }
  rmSync(dbPath);
}

// search_text must match what the original laptop seed produced; every token
// of a SKU, style, name, category, aliases, colour, size and "duck".
const sizeWords: Record<string, string> = { S: "small", M: "medium", L: "large" };
const items = new Map(catalog.products.map(p => [p.code, p]));
const colors = new Map((catalog as any).colors.map((c: any) => [c.code, c]));
const searchText = (variant: any) => [
  variant.sku.toLowerCase().replace(/-/g, " "),
  variant.styleCode.toLowerCase(),
  capsuleWords(items.get(variant.styleCode).name),
  capsuleWords(items.get(variant.styleCode).nameZh),
  capsuleWords(items.get(variant.styleCode).category),
  capsuleWords(items.get(variant.styleCode).aliases),
  colors.get(variant.colorCode).name.toLowerCase(),
  colors.get(variant.colorCode).code.toLowerCase(),
  colors.get(variant.colorCode).aliases,
  variant.size.toLowerCase(),
  sizeWords[variant.size] ?? variant.size.toLowerCase(),
  "duck",
].join(" ");

mkdirSync(dataDirectory, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON;");
db.exec(readFileSync(join(root, "data", "schema.sql"), "utf8"));
db.exec("BEGIN IMMEDIATE");
try {
  const product = db.prepare("INSERT INTO products(style_code,document) VALUES(?,?)");
  const variant = db.prepare("INSERT INTO variants(sku,style_code,color,size,search_text,document) VALUES(?,?,?,?,?,?)");
  const shop = db.prepare("INSERT INTO shops(id,name) VALUES(?,?)");
  const stock = db.prepare("INSERT INTO stock(sku,location_id,quantity,revision) VALUES(?,?,?,?)");
  for (const p of catalog.products) product.run(p.code, JSON.stringify(p));
  for (const v of catalog.variants) variant.run(v.sku, v.styleCode, v.color, v.size, searchText(v), JSON.stringify(v));
  for (const s of catalog.shops) shop.run(s.id, s.name);
  for (const s of catalog.initialStock) stock.run(s.sku, s.locationId, s.quantity, s.revision ?? 1);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  db.close();
  rmSync(dbPath);
  throw error;
}
db.close();
console.log(`Seeded ${dbPath}: ${catalog.products.length} products, ${catalog.variants.length} variants, ` +
  `${catalog.shops.length} shops, ${catalog.initialStock.length} stock rows.`);
