import { readFileSync } from "node:fs";
const duck = JSON.parse(readFileSync(process.env.DUCK_CONFIG ?? ".local-duck/live-connection.json", "utf8"));
const checks = [
  ["http://127.0.0.1:4997/shops", duck.apiKey],
  ["http://127.0.0.1:4997/bonus/cash-scheme", duck.apiKey],
  ["http://127.0.0.1:4997/customers/lookup?phone=85261234568", duck.apiKey],
];
if (duck.staffReadApiKey) checks.push(["http://127.0.0.1:4997/shops?mode=locations", duck.staffReadApiKey], ["http://127.0.0.1:4997/managers", duck.staffReadApiKey]);
if (duck.adminApiKey) checks.push(["http://127.0.0.1:4997/admin/status", duck.adminApiKey]);
if (duck.glacierSeparate) checks.push(["http://127.0.0.1:4998/glacier/health", null]);
else if (duck.glacierApiKey) checks.push(["http://127.0.0.1:4997/glacier/health", null]);
const results = await Promise.all(checks.map(async ([url, key]) => {
  try { return (await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(3000) })).status === 200; }
  catch { return false; }
}));
if (results.some(ok => !ok)) { console.error("One or more service checks failed (no credentials or records logged)"); process.exitCode = 1; }
