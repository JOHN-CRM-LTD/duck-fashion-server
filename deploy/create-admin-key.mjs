import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve(process.env.DUCK_CONFIG ?? ".local-duck/live-connection.json");
const config = JSON.parse(readFileSync(path, "utf8"));
if (config.adminApiKey && (!/^[a-f0-9]{64}$/.test(config.adminApiKey) || [config.apiKey, config.writeApiKey, config.staffReadApiKey, config.glacierApiKey].includes(config.adminApiKey))) throw new Error("Existing admin key is invalid; inspect privately");
if (!config.adminApiKey) {
  config.adminApiKey = randomBytes(32).toString("hex");
  writeFileSync(path + ".tmp", JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(path + ".tmp", path);
  chmodSync(path, 0o600);
}
console.log("Admin key configured; other keys preserved. Keep it in a private operator connection file, never in CRM.");
