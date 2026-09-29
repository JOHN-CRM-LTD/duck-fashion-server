import { request } from "node:http";
import type { RequestHandler } from "express";

/** Transitional fixed upstream: old nginx/CRM URLs survive the service split. */
export const glacierProxy: RequestHandler = (req, res) => {
  const upstream = request({ hostname: "127.0.0.1", port: 4998, path: req.originalUrl, method: req.method,
    headers: { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, timeout: 5000,
  }, response => {
    res.status(response.statusCode ?? 502);
    res.set({ "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => { if (!res.headersSent) res.status(503).json({ error: "Glacier is unavailable" }); else res.destroy(); });
  res.on("close", () => upstream.destroy());
  // Glacier is read-only; its router rejects other methods, no body is forwarded.
  upstream.end();
};
