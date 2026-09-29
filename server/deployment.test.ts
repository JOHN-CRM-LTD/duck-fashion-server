import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountGlacier } from "./glacier/mount.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

test("fresh Duck setup needs no Glacier data and preserves a configured private Glacier on key rotation", () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-setup-test-"));
  try {
    writeFileSync(join(directory, "package.json"), "{}\n");
    const run = () => execFileSync(bash, [join(root, "deploy/create-config.sh").replaceAll("\\", "/"), "https://duck-test.invalid"], { cwd: directory, encoding: "utf8" });
    run();
    const configPath = join(directory, ".local-duck/live-connection.json");
    const initial = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(initial.glacierApiKey, undefined);
    assert.match(initial.apiKey, /^[a-f0-9]{64}$/);
    assert.match(initial.writeApiKey, /^[a-f0-9]{64}$/);
    initial.glacierApiKey = "ab".repeat(32);
    initial.staffReadApiKey = "cd".repeat(32);
    writeFileSync(configPath, JSON.stringify(initial));
    run();
    const rotated = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(rotated.glacierApiKey, initial.glacierApiKey);
    assert.equal(rotated.staffReadApiKey, initial.staffReadApiKey);
    assert.notEqual(rotated.apiKey, initial.apiKey);
    assert.notEqual(rotated.writeApiKey, initial.writeApiKey);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Glacier stays optional on a fresh Duck install and fails explicitly for missing configured data", () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-optional-glacier-"));
  try {
    assert.equal(mountGlacier(express(), { dataDirectory: directory }), null);
    assert.throws(() => mountGlacier(express(), { dataDirectory: directory, glacierApiKey: "ab".repeat(32) }), /restore the private database/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public-data guard accepts source fixtures but rejects forcibly staged private datasets", () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-public-data-"));
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    const add = (path: string, content: string) => {
      const filename = join(directory, path);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, content);
      execFileSync("git", ["add", "-f", "--", path], { cwd: directory });
    };
    const check = () => spawnSync(process.execPath, [join(root, "deploy/check-public-data.mjs")], { cwd: directory, encoding: "utf8" });
    add("data/catalog.json", "[]\n");
    add("server/example.test.ts", "// Fictional fixture generated in a temporary directory.\n");
    assert.equal(check().status, 0);
    add("data/customer-subset.json", "[]\n");
    add("exports/private.tsv.gz", "synthetic test only\n");
    add(".local-duck/live-connection.json", "{}\n");
    const rejected = check();
    assert.equal(rejected.status, 1);
    for (const path of ["data/customer-subset.json", "exports/private.tsv.gz", ".local-duck/live-connection.json"]) {
      assert.ok(rejected.stderr.includes(path));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
