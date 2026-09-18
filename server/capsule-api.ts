import express from "express";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ZodError } from "zod";
import { capsuleItems, capsulePhotoNames } from "./capsule-catalog.js";
import { openCapsule } from "./capsule-store.js";
import { readDuckManagers } from "./manager-directory.js";

const config = JSON.parse(readFileSync(resolve(".local-duck/live-connection.json"), "utf8"));
if (config.mode !== "capsule" || !/^[a-f0-9]{64}$/.test(config.apiKey) || config.port !== 4997 || !config.dataDirectory) throw new Error("Invalid capsule connection configuration");
const expected = Buffer.from(`Bearer ${config.apiKey}`);
const expectedWrite = typeof config.writeApiKey === "string" && /^[a-f0-9]{64}$/.test(config.writeApiKey) ? Buffer.from(`Bearer ${config.writeApiKey}`) : null;
const store = openCapsule(config.dataDirectory, config.url);
const app = express();
app.disable("x-powered-by");
// Only the eight explicitly named product photographs are public. No directory listing,
// database, JSON export, configuration file or staff write credential is exposed.
const imageFiles = capsuleItems.flatMap(item=>[`${item.slug}.png`,...['burgundy','cream','black'].map(c=>`${c}_${capsulePhotoNames[item.code]}.png`)]);
for (const imageFile of imageFiles) app.get(`/images/${imageFile}`, (_req, res) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300" });
  res.sendFile(join(config.dataDirectory, "images", imageFile), error => { if (error && !res.headersSent) res.sendStatus(404); });
});
app.use((req, res, next) => {
  res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  const supplied = Buffer.from(req.headers.authorization ?? "");
  const read = supplied.length === expected.length && timingSafeEqual(supplied, expected);
  const write = expectedWrite && supplied.length === expectedWrite.length && timingSafeEqual(supplied, expectedWrite);
  if (!read && !write) return void res.status(401).json({ error: "Unauthorized" });
  if (req.method === "GET" && req.path === "/managers") {
    if (!write) return void res.status(403).json({ error: "A staff credential is required" });
  } else if (req.method === "POST" && ["/stock/adjust", "/customers/import"].includes(req.path)) {
    if (!write) return void res.status(403).json({ error: "A staff write credential is required" });
  } else if (req.method !== "GET" || !["/inventory", "/products", "/shops", "/bonus/balance", "/bonus/redeemables", "/bonus/cash-scheme", "/customers/lookup"].includes(req.path)) return void res.sendStatus(404);
  next();
});
app.use(express.json({ limit: "8kb", strict: true }));
app.get("/managers", (_req, res) => {
  try { res.json(readDuckManagers(config.managerDirectoryPath)); } catch { res.status(503).json({ error: "Manager directory is not configured or is invalid" }); }
});
app.get("/inventory", (req, res) => {
  const inventory = store.inventory(req.query.query as string);
  if (inventory.hasMore) return void res.status(422).json({ error: "Narrow the inventory search by item name, colour or size. Use product details to browse the complete collection." });
  res.json({ ...inventory, source: "Duck Fashion eight-item SQLite demo", checkedAt: new Date().toISOString() });
});
app.get("/products", (req, res) => res.json(store.products(req.query.query as string, req.query.offset === undefined ? 0 : Number(req.query.offset))));
app.get("/shops", (_req, res) => res.json(store.shops()));
app.get("/customers/lookup", (req, res) => {
  if (typeof req.query.phone !== "string") return void res.status(400).json({ error: "Provide one international phone number" });
  try { res.json(store.customerLookup(req.query.phone)); }
  catch (error) {
    if (error instanceof Error && error.message === "INVALID_CUSTOMER_PHONE") return void res.status(400).json({ error: "Provide a full international phone number" });
    throw error;
  }
});
app.post("/stock/adjust", (req, res) => res.json(store.adjust(req.body)));
app.post("/customers/import", (req, res) => {
  try { res.json(store.importCustomers(req.body?.customers)); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INVALID_CUSTOMERS" || message === "CUSTOMER_PHONE_CONFLICT") return void res.status(message === "CUSTOMER_PHONE_CONFLICT" ? 409 : 400).json({ error: message });
    throw error;
  }
});
// Member bonus points: balance, redeemable items and the Bonus-as-Cash scheme.
// The read key is enough; these are customer-service lookups, never writes.
app.get("/bonus/balance", (req, res) => {
  if (typeof req.query.member !== "string" || !req.query.member.trim()) return void res.status(400).json({ error: "Provide a member code, registered mobile number or member name" });
  res.json(store.bonusBalance(req.query.member));
});
app.get("/bonus/redeemables", (req, res) => res.json(store.bonusRedeemables(typeof req.query.member === "string" ? req.query.member : undefined)));
app.get("/bonus/cash-scheme", (_req, res) => res.json(store.bonusCashScheme()));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "";
  const candidates = (error as { candidates?: unknown })?.candidates;
  const status = error instanceof ZodError || message === "INVALID_QUERY" || message === "INVALID_MEMBER" || (error as { type?: string })?.type === "entity.parse.failed" ? 400 : message === "UNKNOWN_STOCK" || message === "UNKNOWN_MEMBER" ? 404 : message === "AMBIGUOUS_MEMBER" ? 422 : ["STOCK_CONFLICT", "IDEMPOTENCY_CONFLICT", "INVALID_STOCK"].includes(message) ? 409 : 503;
  res.status(status).json({ error: status === 503 ? "Demo stock is temporarily unavailable" : status === 400 ? "Provide valid product search or stock adjustment fields" : message, ...(Array.isArray(candidates) ? { candidates } : {}) });
});
const server = app.listen(config.port, "127.0.0.1", () => console.log(`Duck Fashion eight-item demo ready on 127.0.0.1:${config.port}; database ${config.dataDirectory}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
