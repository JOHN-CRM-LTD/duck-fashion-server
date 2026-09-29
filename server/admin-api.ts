import express from "express";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import type { openCapsule } from "./capsule-store.js";

export function adminRouter(store: ReturnType<typeof openCapsule>, key: string, revision: string) {
  const router = express.Router();
  const expected = Buffer.from(`Bearer ${key}`);
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    const actual = Buffer.from(req.headers.authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return void res.status(401).json({ error: "Unauthorized" });
    next();
  });
  router.use(express.json({ limit: "16kb", strict: true }));
  router.get("/status", (_req, res) => res.json({ service: "duck-fashion", revision, uptimeSeconds: Math.floor(process.uptime()) }));
  router.get("/locations", (req, res) => res.json(store.locations(req.query.offset, req.query.limit)));
  router.get("/locations/:shopId", (req, res) => res.json(store.adminLocation(req.params.shopId)));
  router.get("/locations/:shopId/history", (req, res) => res.json({ changes: store.locationHistory(req.params.shopId) }));
  router.patch("/locations/:shopId", (req, res) => res.json(store.updateLocation(req.params.shopId, req.body)));
  router.use((_req, res) => res.status(404).json({ error: "Unknown admin operation" }));
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof ZodError || (error as { type?: string })?.type === "entity.parse.failed" ? 400
      : message === "UNKNOWN_LOCATION" ? 404 : ["LOCATION_CONFLICT", "IDEMPOTENCY_CONFLICT", "MULTIPLE_DEFAULT_LOCATIONS"].includes(message) ? 409
      : message === "INVALID_LOCATION_PAGE" ? 400 : 503;
    res.status(status).json({ error: status === 400 ? "INVALID_LOCATION_UPDATE_OR_QUERY" : status === 503 ? "SOURCE_UNAVAILABLE" : message });
  });
  return router;
}
