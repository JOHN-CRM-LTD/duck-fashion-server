// Operator client. Credentials are read from a private file, never command arguments.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
const args = process.argv.slice(2);
const [command, shopId, value, extra] = args;
if (!command || command === "help") {
  console.log(`npm run admin -- status
npm run admin -- locations
npm run admin -- location PCB
npm run admin -- set-manager PCB +85212345678 "Manager name"
npm run admin -- update PCB private-changes.json
npm run admin -- history PCB
npm run admin -- undo PCB <requestId>
npm run admin -- retry .local-duck/remote-pending.json
npm run admin -- plan PCB private-changes.json

Set DUCK_ADMIN_CONNECTION to a private JSON file containing {"url":"https://duckserver.johncrm.com/stock-api","adminApiKey":"..."}.
Alternatively on the Pi set DUCK_CONFIG to its private connection file; local requests use loopback.
update accepts editable location fields (hours, address, manager, status, etc.).
plan prints a one-time change entry for config/duck-fashion/location-changes.json; review before committing.`);
  process.exit(0);
}
try {
  const local = !process.env.DUCK_ADMIN_CONNECTION && process.env.DUCK_CONFIG;
  const connection = JSON.parse(readFileSync(resolve(process.env.DUCK_ADMIN_CONNECTION ?? process.env.DUCK_CONFIG ?? ".local-duck/admin-connection.json"), "utf8"));
  const base = new URL(local ? "http://127.0.0.1:4997" : connection.url);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) throw new Error("Use HTTPS or a loopback SSH tunnel");
  if (!/^[a-f0-9]{64}$/.test(connection.adminApiKey ?? "")) throw new Error("A dedicated adminApiKey is required");
  async function request(path, method = "GET", body) {
    const response = await fetch(`${base.href.replace(/\/+$/, "")}/admin${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${connection.adminApiKey}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error ?? "Operation failed"}`);
    return result;
  }
  const path = `/locations/${encodeURIComponent(shopId ?? "")}`;
  let result;
  if (command === "status") result = await request("/status");
  else if (command === "locations") {
    const locations = []; let revision;
    for (let offset = 0; offset < 5000; offset += 50) {
      const page = await request(`/locations?offset=${offset}&limit=50`);
      if (revision && page.revision !== revision) throw new Error("Locations changed while reading; retry");
      revision = page.revision; locations.push(...page.locations);
      if (!page.hasMore) break;
    }
    result = { locations, revision };
  } else if (!shopId) throw new Error("Provide a shop ID");
  else if (command === "location") result = await request(path);
  else if (command === "history") result = await request(`${path}/history`);
  else if (["set-manager", "update", "plan", "undo"].includes(command)) {
    if (!value) throw new Error("Provide the number, change file or history request ID");
    const current = await request(path);
    let changes;
    if (command === "set-manager") changes = { managerPhone: value, ...(extra ? { managerName: extra } : {}) };
    else if (command === "undo") {
      const history = await request(`${path}/history`);
      const change = history.changes.find(row => row.requestId === value);
      if (!change || change.revision !== current.revision) throw new Error("Only an unchanged latest edit can be undone; inspect history before making a new edit");
      const { id, inventoryLocationId, ...before } = change.before;
      changes = before;
    } else changes = JSON.parse(readFileSync(resolve(value), "utf8"));
    const input = { requestId: randomUUID(), expectedRevision: current.revision, changes, reason: command === "undo" ? `Undo ${value}` : "Remote demo configuration update" };
    if (command === "plan") result = { shopId, ...input };
    else {
      // A recoverable request file allows an identical retry after a network timeout.
      const pending = resolve(process.env.DUCK_ADMIN_PENDING ?? ".local-duck/remote-pending.json");
      mkdirSync(dirname(pending), { recursive: true, mode: 0o700 });
      writeFileSync(pending, JSON.stringify({ shopId, ...input }, null, 2) + "\n", { mode: 0o600 });
      result = await request(path, "PATCH", input);
    }
  } else if (command === "retry") {
    const { shopId: retryShop, ...input } = JSON.parse(readFileSync(resolve(value ?? shopId), "utf8"));
    result = await request(`/locations/${encodeURIComponent(retryShop)}`, "PATCH", input);
  } else throw new Error("Unknown command; run npm run admin -- help");
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "Admin operation failed"); process.exitCode = 1; }
