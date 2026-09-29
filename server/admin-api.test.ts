import express from "express";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { openCapsule } from "./capsule-store.js";
import { adminRouter } from "./admin-api.js";

test("remote operator auth, CLI edit/undo, and manager/CRM consistency", { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-admin-test-"));
  const tsx = import.meta.resolve("tsx"), key = "ab".repeat(32);
  execFileSync(process.execPath, ["--import", tsx, resolve("server/seed-capsule.ts"), "--data", directory], { stdio: "pipe" });
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ dataDirectory: directory }));
  execFileSync(process.execPath, ["--import", tsx, resolve("server/import-locations.ts"), "--demo"], { env: { ...process.env, DUCK_CONFIG: configPath }, stdio: "pipe" });
  const store = openCapsule(directory, "https://duck.invalid");
  const app = express(); app.use("/admin", adminRouter(store, key, "test-sha"));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const connectionPath = join(directory, "admin.json");
  writeFileSync(connectionPath, JSON.stringify({ url: base, adminApiKey: key }));
  const cli = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, [resolve("deploy/admin.mjs"), ...args], { env: { ...process.env, DUCK_ADMIN_CONNECTION: connectionPath, DUCK_ADMIN_PENDING: join(directory, "pending.json") } })).stdout);
  try {
    for (const auth of [undefined, "cd".repeat(32), "ef".repeat(32)]) {
      assert.equal((await fetch(`${base}/admin/locations`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} })).status, 401);
    }
    const response = await fetch(`${base}/admin/status`, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).revision, "test-sha");
    const old = await cli("location", "PCB");
    const changed = await cli("set-manager", "PCB", "+85291234567", "Demo manager");
    assert.equal(changed.location.managerPhone, "+85291234567");
    assert.equal(store.managers()!.managers.find(row => row.shopId === "PCB")!.phone, changed.location.managerPhone);
    assert.equal(store.locations().locations.find(row => row.inventoryLocationId === "PCB")!.managerPhone, changed.location.managerPhone);
    const history = await cli("history", "PCB");
    await cli("undo", "PCB", history.changes[0].requestId);
    assert.equal((await cli("location", "PCB")).location.managerPhone, old.location.managerPhone);
    const stale = await fetch(`${base}/admin/locations/PCB`, { method: "PATCH", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "stale-http-change", expectedRevision: changed.revision, changes: { isActive: false }, reason: "Stale edit" }) });
    assert.equal(stale.status, 409);
    assert.equal((await cli("retry", join(directory, "pending.json"))).replayed, true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok()));
    store.close(); rmSync(directory, { recursive: true, force: true });
  }
});
