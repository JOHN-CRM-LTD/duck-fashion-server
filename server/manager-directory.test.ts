import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDuckManagers } from "./manager-directory.js";

test("demo defaults cover all shops and explicit invalid overrides fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "duck-managers-")), path = join(directory, "managers.json");
  try {
    const defaults = readDuckManagers(path).managers;
    assert.deepEqual(defaults.map(m => m.shopId), ["PCB", "PCL", "SH015"]);
    assert.ok(defaults.every(m => m.phone === "+85296540199"));
    writeFileSync(path, JSON.stringify({ managers: [{ shopId: "PCB", name: "Manager", phone: "+85261234567" }] }));
    assert.equal(readDuckManagers(path).managers[0].phone, "+85261234567");
    writeFileSync(path, "not json");
    assert.throws(() => readDuckManagers(path));
    writeFileSync(path, JSON.stringify({ managers: [defaults[0], defaults[0]] }));
    assert.throws(() => readDuckManagers(path), /Duplicate/);
  } finally { rmSync(directory, { recursive: true }); }
});
