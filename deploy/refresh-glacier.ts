import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readDuckConfig } from "../server/runtime-config.js";
import { seedGlacierSnapshot } from "../server/glacier-seed.js";

const duck = readDuckConfig();
const glacier = duck.glacierSeparate ? JSON.parse(readFileSync(process.env.GLACIER_CONFIG ?? "/srv/glacier/config/connection.json", "utf8")) : null;
const database = glacier?.databasePath ?? join(duck.dataDirectory, "glacier-icerink.sqlite");
if (!glacier && !duck.glacierApiKey) process.exit(0);
const snapshot = resolve("data/glacier-icerink.tsv.gz");
const digest = createHash("sha256").update(readFileSync(snapshot)).digest("hex");
const stamp = `${database}.sha256`;
if (!existsSync(database) || !existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== digest) {
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  await seedGlacierSnapshot(snapshot, database);
  writeFileSync(`${stamp}.tmp`, digest + "\n", { mode: 0o600 });
  renameSync(`${stamp}.tmp`, stamp);
  console.log("Glacier snapshot refreshed atomically.");
}
