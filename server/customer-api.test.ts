import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

test("Pi HTTP API authenticates bounded browsing and keeps exact lookup separate", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-customer-api-test-"));
  const apiKey = randomBytes(32).toString("hex");
  const tsx = import.meta.resolve("tsx");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    execFileSync(process.execPath, ["--import", tsx, resolve("server/seed-capsule.ts"), "--data", directory], { stdio: "pipe" });
    mkdirSync(join(directory, ".local-duck"));
    writeFileSync(join(directory, ".local-duck/live-connection.json"), JSON.stringify({ mode: "capsule", apiKey, port: 4997, dataDirectory: directory, url: "http://127.0.0.1:4997" }));
    child = spawn(process.execPath, ["--import", tsx, resolve("server/capsule-api.ts")], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("Test API did not start")), 7000);
      child!.once("exit", code => { clearTimeout(timer); fail(new Error(`Test API exited: ${code}`)); });
      child!.stdout!.on("data", data => { if (String(data).includes("demo ready")) { clearTimeout(timer); ok(); } });
    });
    const read = (query: string, authorized = true) => fetch(`http://127.0.0.1:4997/customers/lookup${query}`, { headers: authorized ? { Authorization: `Bearer ${apiKey}` } : {} });
    assert.equal((await read("?mode=browse", false)).status, 401);
    assert.equal((await read("")).status, 400);
    assert.equal((await read("?mode=other")).status, 400);
    assert.equal((await read("?mode=browse&phone=%2B85261234567")).status, 400);
    for (const query of ["limit=51", "limit=0", "offset=-1", "offset=1.5", "query=a&query=b"]) assert.equal((await read(`?mode=browse&${query}`)).status, 400);
    const firstResponse = await read("?mode=browse&offset=0&limit=2");
    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get("cache-control"), "no-store");
    const first = await firstResponse.json();
    assert.equal(first.customers.length, 2);
    assert.equal(first.hasMore, true);
    const second = await (await read("?mode=browse&offset=2&limit=2")).json();
    assert.equal(new Set([...first.customers, ...second.customers].map(c => c.id)).size, 4);
    const all = await (await read("?mode=browse&limit=50")).json();
    assert.equal(all.customers.length, 8);
    assert.equal(all.hasMore, false);
    const lookup = await (await read(`?phone=${encodeURIComponent(first.customers[0].phone)}`)).json();
    assert.equal(lookup.customers[0].id, first.customers[0].id);
    assert.equal(lookup.complete, true);
    const searched = await (await read(`?mode=browse&query=${encodeURIComponent(first.customers[0].id)}`)).json();
    assert.equal(searched.customers[0].id, first.customers[0].id);
    const empty = await (await read("?mode=browse&query=nonexistent-test-member")).json();
    assert.deepEqual(empty.customers, []);
    assert.equal(empty.hasMore, false);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("duck-customer-api-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
