import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
if (!process.argv[2]) throw new Error("Provide a new private output filename; transfer it securely to your operator machine");
const config = JSON.parse(readFileSync(process.env.DUCK_CONFIG ?? ".local-duck/live-connection.json", "utf8"));
if (!/^[a-f0-9]{64}$/.test(config.adminApiKey ?? "")) throw new Error("Run deploy/create-admin-key.mjs first");
const url = new URL(process.argv[3] ?? config.url);
if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new Error("Use HTTPS or a loopback SSH tunnel");
writeFileSync(resolve(process.argv[2]), JSON.stringify({ url: url.href.replace(/\/+$/, ""), adminApiKey: config.adminApiKey }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log("Private operator connection written. Transfer securely; never commit it or add it to CRM.");
