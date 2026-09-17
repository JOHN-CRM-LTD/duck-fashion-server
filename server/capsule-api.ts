import express from "express";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ZodError } from "zod";
import { capsuleItems, capsulePhotoNames } from "./capsule-catalog.js";
import { openCapsule } from "./capsule-store.js";

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
  if (req.method === "POST" && req.path === "/stock/adjust") {
    if (!write) return void res.status(403).json({ error: "A staff write credential is required" });
  } else if (req.method !== "GET" || !["/inventory", "/products", "/shops"].includes(req.path)) return void res.sendStatus(404);
  next();
});
app.use(express.json({ limit: "8kb", strict: true }));
app.get("/inventory", (req, res) => {
  const inventory = store.inventory(req.query.query as string);
  if (inventory.hasMore) return void res.status(422).json({ error: "Narrow the inventory search by item name, colour or size. Use product details to browse the complete collection." });
  res.json({ ...inventory, source: "Duck Fashion eight-item SQLite demo", checkedAt: new Date().toISOString() });
});
app.get("/products", (req, res) => res.json(store.products(req.query.query as string, req.query.offset === undefined ? 0 : Number(req.query.offset))));
app.get("/shops", (_req, res) => res.json(store.shops()));
app.post("/stock/adjust", (req, res) => res.json(store.adjust(req.body)));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "";
  const status = error instanceof ZodError || message === "INVALID_QUERY" || (error as { type?: string })?.type === "entity.parse.failed" ? 400 : message === "UNKNOWN_STOCK" ? 404 : ["STOCK_CONFLICT", "IDEMPOTENCY_CONFLICT", "INVALID_STOCK"].includes(message) ? 409 : 503;
  res.status(status).json({ error: status === 503 ? "Demo stock is temporarily unavailable" : status === 400 ? "Provide valid product search or stock adjustment fields" : message });
});
const server = app.listen(config.port, "127.0.0.1", () => console.log(`Duck Fashion eight-item demo ready on 127.0.0.1:${config.port}; database ${config.dataDirectory}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
