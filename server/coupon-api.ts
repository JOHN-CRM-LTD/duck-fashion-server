import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";

/** Small authenticated BOSS-compatible feed for John CRM's existing coupon endpoint.
 * The staff write key stays server-side; read credentials cannot issue or list coupons. */
export function couponRouter(writeKey: string | undefined, coupons: (phone: unknown) => unknown[]) {
  const router = express.Router(), sessions = new Map<string, { until: number; loggedIn: boolean }>();
  const matches = (value: unknown) => typeof value === "string" && typeof writeKey === "string" && /^[a-f0-9]{64}$/.test(writeKey)
    && Buffer.byteLength(value) === Buffer.byteLength(writeKey) && timingSafeEqual(Buffer.from(value), Buffer.from(writeKey));
  router.use(express.json({ limit: "8kb", strict: false }));
  router.use((_req, res, next) => { res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); next(); });
  router.post("/login", (req, res) => {
    if (req.body?.UserName !== "duck" || !matches(req.body?.Password)) return void res.status(401).json({ Error: "Unauthorized" });
    for (const [id, session] of sessions) if (session.until < Date.now()) sessions.delete(id);
    if (sessions.size >= 256) return void res.status(429).json({ Error: "Try again shortly" });
    const id = randomBytes(32).toString("base64url"); sessions.set(id, { until: Date.now() + 300000, loggedIn: false });
    res.json({ Data: true, WarningMsg: [id] });
  });
  router.post("/Logout", (req, res) => { if (typeof req.body === "string") sessions.delete(req.body); res.json({ Data: true }); });
  router.post("/OpenAPI", (req, res) => {
    const session = sessions.get(req.body?.loginID);
    if (!session || session.until <= Date.now()) return void res.status(401).json({ Error: "Unauthorized" });
    const params = Array.isArray(req.body?.stringParms) ? req.body.stringParms : [];
    const value = (key: string) => params.find((row: { Name?: string }) => row?.Name === key)?.Value;
    if (req.body.funcNo === "custom_server.login") {
      if (value("user_id") !== "duck" || !matches(value("user_password"))) return void res.status(401).json({ Error: "Unauthorized" });
      session.loggedIn = true; return void res.json({ Data: { ReturnCode: 1 } });
    }
    if (!session.loggedIn) return void res.status(401).json({ Error: "Unauthorized" });
    if (req.body.funcNo === "custom_server.logout") { session.loggedIn = false; return void res.json({ Data: { ReturnCode: 1 } }); }
    if (req.body.funcNo !== "custom_server.process_data" || value("process_action") !== "get_data" || value("process_target") !== "coupon")
      return void res.status(400).json({ Error: "Unsupported operation" });
    try { res.json({ Data: { ReturnCode: 1, ReturnData: JSON.stringify(coupons(value("DATA"))) } }); }
    catch { res.status(400).json({ Error: "Provide a full international phone number" }); }
  });
  return router;
}
