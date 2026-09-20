import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve(".local-duck/live-connection.json");
const config = JSON.parse(readFileSync(path, "utf8"));
if (config.staffReadApiKey && (!/^[a-f0-9]{64}$/.test(config.staffReadApiKey) || [config.apiKey, config.writeApiKey].includes(config.staffReadApiKey))) throw new Error("Existing staff read credential is invalid; review it without rotating other keys");
if (!config.staffReadApiKey) {
  config.staffReadApiKey = randomBytes(32).toString("hex");
  writeFileSync(path + ".tmp", JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(path + ".tmp", path);
  chmodSync(path, 0o600);
}
console.log("Staff read key is configured. Enter it only in the CRM's encrypted staff-only endpoint credential field. No write permission is granted.");
