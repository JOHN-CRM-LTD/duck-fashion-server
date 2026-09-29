import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteGlacierProvider } from "./sqlite-provider.js";
import { createGlacierRouter } from "./router.js";

const config = JSON.parse(readFileSync(resolve(process.env.GLACIER_CONFIG ?? ".local-glacier/connection.json"), "utf8"));
if (config.port !== 4998 || typeof config.apiKey !== "string" || !/^[a-f0-9]{64}$/.test(config.apiKey)
  || typeof config.databasePath !== "string" || !existsSync(config.databasePath)) throw new Error("Invalid Glacier configuration or missing snapshot database");
const provider = SqliteGlacierProvider.open(config.databasePath);
const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => { res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); next(); });
// Preserve the CRM's existing /stock-api/glacier URLs through nginx.
app.use("/glacier", createGlacierRouter(provider, config.apiKey));
const server = app.listen(config.port, "127.0.0.1", () => console.log("Glacier ready on 127.0.0.1:4998"));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => { provider.close(); process.exit(0); }));
