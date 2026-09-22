import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Express } from "express";
import { createGlacierRouter } from "./router.js";
import { SqliteGlacierProvider } from "./sqlite-provider.js";

/**
 * Mounts the Glacier read API under /glacier when the connection config carries a glacier API key.
 * No key (fresh clones, CI without the dataset) leaves the service exactly as before; a key without
 * the seeded snapshot database is an operator error and stops the boot with the fix in the message.
 */
export function mountGlacier(app: Express, options: { dataDirectory: string; glacierApiKey?: unknown; databaseFile?: string }): SqliteGlacierProvider | null {
  const key = typeof options.glacierApiKey === "string" ? options.glacierApiKey : "";
  const database = join(options.dataDirectory, options.databaseFile ?? "glacier-icerink.sqlite");
  if (!key) {
    if (existsSync(database)) console.log("Glacier snapshot present but no glacierApiKey is configured; /glacier routes stay off.");
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid glacierApiKey in live-connection.json: 64 lowercase hex characters, from deploy/create-config.sh.");
  if (!existsSync(database)) throw new Error(`glacierApiKey is configured but ${database} is missing — rebuild it with: npm run seed:glacier`);
  const provider = SqliteGlacierProvider.open(database);
  app.use("/glacier", createGlacierRouter(provider, key));
  console.log(`Glacier read API mounted at /glacier (snapshot database ${database})`);
  return provider;
}
