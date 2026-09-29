import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
const url = new URL(process.argv[2]);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Provide a public HTTPS base URL without credentials, query or fragment");
const path = resolve(process.env.DUCK_CONFIG ?? ".local-duck/live-connection.json");
const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { mode: "capsule", port: 4997, dataDirectory: resolve("data") };
for (const field of ["apiKey", "writeApiKey", ...(!config.glacierSeparate ? ["glacierApiKey"] : [])]) {
  if (config[field] !== undefined && (typeof config[field] !== "string" || !/^[a-f0-9]{64}$/.test(config[field]))) throw new Error(`Existing ${field} is invalid; review privately instead of replacing it`);
  config[field] ??= randomBytes(32).toString("hex");
}
config.url = url.href.replace(/\/+$/, "");
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
writeFileSync(path + ".tmp", JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
renameSync(path + ".tmp", path); chmodSync(path, 0o600);
console.log("Connection configured. Existing credentials and settings preserved; secrets are in the private config file.");
