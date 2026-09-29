import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

test("config URL changes preserve all credentials and private settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-config-test-"));
  try {
    const path = join(directory, "connection.json");
    const env = { ...process.env, DUCK_CONFIG: path };
    execFileSync(process.execPath, [resolve("deploy/create-config.mjs"), "https://first.invalid/stock-api"], { env, stdio: "pipe" });
    const old = JSON.parse(readFileSync(path, "utf8"));
    old.staffReadApiKey = "ab".repeat(32); old.adminApiKey = "cd".repeat(32); old.customSetting = true;
    writeFileSync(path, JSON.stringify(old));
    execFileSync(process.execPath, [resolve("deploy/create-config.mjs"), "https://second.invalid/stock-api"], { env, stdio: "pipe" });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { ...old, url: "https://second.invalid/stock-api" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("split migration preserves Duck state and keys; Glacier failure does not stop Duck", { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-split-test-"));
  const tsx = import.meta.resolve("tsx");
  const configPath = join(directory, "source.json"), root = join(directory, "services");
  const original = { mode: "capsule", apiKey: "ab".repeat(32), writeApiKey: "cd".repeat(32), staffReadApiKey: "ef".repeat(32), glacierApiKey: "12".repeat(32), port: 4997, dataDirectory: directory, url: "https://duck.invalid/stock-api" };
  const run = (path: string, ...args: string[]) => execFileSync(process.execPath, ["--import", tsx, resolve(path), ...args], { env: { ...process.env, DUCK_CONFIG: configPath }, stdio: "pipe" });
  const children: ReturnType<typeof spawn>[] = [];
  const start = async (path: string, environment: Record<string, string>, ready: string) => {
    const child = spawn(process.execPath, ["--import", tsx, resolve(path)], { env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("Startup timeout")), 7000);
      child.once("exit", code => { clearTimeout(timer); fail(new Error(`Process exited ${code}`)); });
      child.stdout!.on("data", data => { if (String(data).includes(ready)) { clearTimeout(timer); ok(); } });
    });
    return child;
  };
  try {
    run("server/seed-capsule.ts", "--data", directory);
    writeFileSync(configPath, JSON.stringify(original)); run("server/import-locations.ts", "--demo");
    const originalDb = new DatabaseSync(join(directory, "duck-fashion.sqlite"));
    originalDb.exec("UPDATE stock SET quantity=37,revision=11"); originalDb.close();
    run("deploy/prepare-layout.ts", configPath, root);
    const duckConfigPath = join(root, "duck-fashion/config/connection.json");
    const glacierConfigPath = join(root, "glacier/config/connection.json");
    const duck = JSON.parse(readFileSync(duckConfigPath, "utf8"));
    const glacier = JSON.parse(readFileSync(glacierConfigPath, "utf8"));
    assert.equal(duck.apiKey, original.apiKey); assert.equal(duck.writeApiKey, original.writeApiKey);
    assert.equal(duck.staffReadApiKey, original.staffReadApiKey); assert.equal(duck.glacierApiKey, undefined);
    assert.equal(glacier.apiKey, original.glacierApiKey); assert.equal(duck.glacierSeparate, true);
    assert.ok(existsSync(join(root, "duck-fashion/backups/pre-split.sqlite")));
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), original);
    const copied = new DatabaseSync(join(duck.dataDirectory, "duck-fashion.sqlite"), { readOnly: true });
    assert.equal(copied.prepare("SELECT COUNT(*) n FROM stock WHERE quantity=37 AND revision=11").get()!.n, 216); copied.close();
    assert.throws(() => run("deploy/prepare-layout.ts", configPath, root));
    const glacierChild = await start("server/glacier/api.ts", { GLACIER_CONFIG: glacierConfigPath }, "Glacier ready");
    await start("server/capsule-api.ts", { DUCK_CONFIG: duckConfigPath }, "demo ready");
    assert.equal((await fetch("http://127.0.0.1:4998/glacier/health")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:4997/glacier/health")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:4998/glacier/v1/students", { headers: { Authorization: `Bearer ${duck.apiKey}` } })).status, 401);
    const stopped = once(glacierChild, "exit"); glacierChild.kill(); await stopped;
    assert.equal((await fetch("http://127.0.0.1:4997/glacier/health")).status, 503);
    assert.equal((await fetch("http://127.0.0.1:4997/shops", { headers: { Authorization: `Bearer ${duck.apiKey}` } })).status, 200);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
