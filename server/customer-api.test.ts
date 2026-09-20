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
  const writeApiKey = randomBytes(32).toString("hex");
  const staffReadApiKey = randomBytes(32).toString("hex");
  const tsx = import.meta.resolve("tsx");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    execFileSync(process.execPath, ["--import", tsx, resolve("server/seed-capsule.ts"), "--data", directory], { stdio: "pipe" });
    mkdirSync(join(directory, ".local-duck"));
    writeFileSync(join(directory, ".local-duck/live-connection.json"), JSON.stringify({ mode: "capsule", apiKey, staffReadApiKey, writeApiKey, port: 4997, dataDirectory: directory, url: "http://127.0.0.1:4997" }));
    execFileSync(process.execPath, ["--import", tsx, resolve("server/import-locations.ts"), "--demo"], { cwd: directory, stdio: "pipe" });
    child = spawn(process.execPath, ["--import", tsx, resolve("server/capsule-api.ts")], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("Test API did not start")), 7000);
      child!.once("exit", code => { clearTimeout(timer); fail(new Error(`Test API exited: ${code}`)); });
      child!.stdout!.on("data", data => { if (String(data).includes("demo ready")) { clearTimeout(timer); ok(); } });
    });
    const read = (query: string, authorized = true) => fetch(`http://127.0.0.1:4997/customers/lookup${query}`, { headers: authorized ? { Authorization: `Bearer ${apiKey}` } : {} });
    const directoryRead = (key: string, query = "") => fetch(`http://127.0.0.1:4997/shops?mode=locations${query}`, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal((await directoryRead(apiKey)).status, 403);
    const locationsResponse = await directoryRead(staffReadApiKey);
    assert.equal(locationsResponse.headers.get("cache-control"), "no-store");
    const locations = await locationsResponse.json();
    assert.equal(locations.locations.length, 3); assert.equal(locations.hasMore, false);
    assert.equal(locations.locations[0].inventoryLocationId, "PCB");
    assert.equal((await directoryRead(staffReadApiKey, "&limit=51")).status, 400);
    assert.equal((await fetch("http://127.0.0.1:4997/stock/adjust", { method: "POST", headers: { Authorization: `Bearer ${staffReadApiKey}`, "Content-Type": "application/json" }, body: "{}" })).status, 403);
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
    assert.equal(all.customers.length, 6);
    assert.ok(all.customers.every((customer: { id: string; membershipPoints: number }) => !customer.id.startsWith("DF-DEMO") && Number.isInteger(customer.membershipPoints)));
    assert.equal(all.hasMore, false);
    const lookup = await (await read(`?phone=${encodeURIComponent(first.customers[0].phone)}`)).json();
    assert.equal(lookup.customers[0].id, first.customers[0].id);
    assert.equal(lookup.complete, true);
    const personalRead = (path: string, member: string, phone?: string) => fetch(`http://127.0.0.1:4997/bonus/${path}?${new URLSearchParams({ member, ...(phone === undefined ? {} : { phone }) })}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const matched = all.customers[0];
    const balanceResponse = await personalRead("balance", matched.id, matched.phone);
    assert.equal(balanceResponse.status, 200);
    const balance = await balanceResponse.json();
    assert.equal(balance.member.memberCode, matched.id);
    assert.equal(balance.availablePoints, matched.membershipPoints);
    for (const path of ["balance", "redeemables"]) {
      for (const phone of [undefined, all.customers[1].phone, matched.phone.slice(-8)]) {
        const denied = await personalRead(path, matched.id, phone);
        assert.equal(denied.status, 403);
        assert.deepEqual(await denied.json(), { error: "The member ID and registered phone number could not be verified" });
      }
      assert.equal((await personalRead(path, "DF-DEMO-AU", "+85261234591")).status, 403);
    }
    const searched = await (await read(`?mode=browse&query=${encodeURIComponent(first.customers[0].id)}`)).json();
    assert.equal(searched.customers[0].id, first.customers[0].id);
    const empty = await (await read("?mode=browse&query=nonexistent-test-member")).json();
    assert.deepEqual(empty.customers, []);
    assert.equal(empty.hasMore, false);
    const post = (path: string, body: unknown, key?: string) => fetch(`http://127.0.0.1:4997${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
    const request = { member: "DF1010", phone: "+85261234510", rewardId: "CASH-500", expectedPoints: 500, expectedAmount: 5, expectedName: "Duck Fashion HK$5 cash coupon", requestId: "http-coupon-request-0001" };
    assert.equal((await post("/bonus/redeem", request)).status, 401);
    assert.equal((await post("/bonus/redeem", request, apiKey)).status, 403);
    const issuedResponse = await post("/bonus/redeem", request, writeApiKey);
    assert.equal(issuedResponse.status, 200);
    const issued = await issuedResponse.json();
    assert.equal(issued.balanceAfter, 220); assert.equal(issued.coupon.coupon_amt, 5);
    assert.deepEqual(await (await post("/bonus/redeem", request, writeApiKey)).json(), issued);
    assert.equal((await post("/coupons/login", { UserName: "duck", Password: apiKey })).status, 401);
    const login = await (await post("/coupons/login", { UserName: "duck", Password: writeApiKey })).json();
    const loginID = login.WarningMsg[0];
    const command = (funcNo: string, fields: Record<string,string>) => post("/coupons/OpenAPI", { loginID, funcNo, stringParms: Object.entries(fields).map(([Name,Value]) => ({ Name,Value })) });
    assert.equal((await command("custom_server.process_data", {})).status, 401);
    assert.equal((await command("custom_server.login", { user_id: "duck", user_password: writeApiKey })).status, 200);
    const feed = await (await command("custom_server.process_data", { process_action: "get_data", process_target: "coupon", DATA: request.phone })).json();
    assert.equal(feed.Data.ReturnCode, 1);
    assert.deepEqual(JSON.parse(feed.Data.ReturnData), [{ ...issued.coupon, mbr_code: request.member }]);
    await post("/coupons/Logout", loginID);
    assert.equal((await command("custom_server.process_data", {})).status, 401);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("duck-customer-api-test-"));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
