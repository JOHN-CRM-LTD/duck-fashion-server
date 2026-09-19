import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCapsule } from "./capsule-store.js";

for (const [baseUrl, expectedBase] of [
  ["https://duck.example.com", "https://duck.example.com"],
  ["https://duck.example.com/", "https://duck.example.com"],
  ["https://duckserver.johncrm.com/stock-api", "https://duckserver.johncrm.com/stock-api"],
  ["https://duckserver.johncrm.com/stock-api/", "https://duckserver.johncrm.com/stock-api"],
  ["https://duckserver.johncrm.com/stock-api///", "https://duckserver.johncrm.com/stock-api"],
  ["http://127.0.0.1:4997/", "http://127.0.0.1:4997"],
]) {
  test(`product and inventory photo links preserve the public base ${baseUrl}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "duck-public-url-test-"));
    const databasePath = join(directory, "duck-fashion.sqlite");
    let store: ReturnType<typeof openCapsule> | undefined;
    try {
      const db = new DatabaseSync(databasePath);
      try {
        db.exec(readFileSync(new URL("../data/schema.sql", import.meta.url), "utf8"));
        const product = {
          sku: "DF05-BLK-M", styleCode: "DF05", name: "Fixture hoodie", color: "Ink Black",
          size: "M", variant: "Ink Black / M", imageFile: "black_hoodie.png",
          images: [{ imageFile: "cream_hoodie.png", color: "Chalk Cream" }],
        };
        db.prepare("INSERT INTO products VALUES (?,?)").run("DF05", "{}");
        db.prepare("INSERT INTO variants VALUES (?,?,?,?,?,?)")
          .run(product.sku, product.styleCode, product.color, product.size, "hoodie", JSON.stringify(product));
        db.prepare("INSERT INTO shops VALUES (?,?)").run("PCL", "Fixture shop");
        db.prepare("INSERT INTO stock VALUES (?,?,?,?)").run(product.sku, "PCL", 7, 2);
      } finally { db.close(); }
      store = openCapsule(directory, baseUrl);
      const product = store.products("hoodie").items[0];
      const inventory = store.inventory("hoodie").items[0];
      assert.equal(product.imageUrl, `${expectedBase}/images/black_hoodie.png`);
      assert.equal(product.productUrl, product.imageUrl);
      assert.equal(product.images[0].imageUrl, `${expectedBase}/images/cream_hoodie.png`);
      assert.equal(inventory.imageUrl, product.imageUrl);
      assert.equal(inventory.quantity, 7);
      assert.equal(inventory.stockVersion, 2);
    } finally {
      store?.close();
      rmSync(databasePath, { force: true });
      rmdirSync(directory);
    }
  });
}

test("rejects non-HTTP and credential-bearing or ambiguous public URLs before opening a database", () => {
  for (const publicUrl of [
    "file:///data", "https://user:password@duck.example.com", "https://duck.example.com?token=secret",
    "https://duck.example.com#stock-api",
  ]) {
    assert.throws(() => openCapsule("does-not-exist", publicUrl), /Public API URL must be/);
  }
});
