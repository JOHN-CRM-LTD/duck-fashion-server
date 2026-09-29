import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { readDuckConfig } from "../server/runtime-config.js";
import { seedGlacierSnapshot } from "../server/glacier-seed.js";
import { backupDatabase } from "./backup.js";

const duck = readDuckConfig();
const glacier = duck.glacierSeparate ? JSON.parse(readFileSync(process.env.GLACIER_CONFIG ?? "/srv/glacier/config/connection.json", "utf8")) : null;
const database = glacier?.databasePath ?? join(duck.dataDirectory, "glacier-icerink.sqlite");
if (!glacier && !duck.glacierApiKey) throw new Error("Glacier is not configured");
if (process.argv.length !== 3) throw new Error("Usage: node --import tsx deploy/refresh-glacier.ts /private/path/export.tsv.gz");
const snapshot = realpathSync(process.argv[2]);
const sourceRelative = relative(realpathSync(resolve(".")), snapshot);
if (!sourceRelative.startsWith("..") && !isAbsolute(sourceRelative)) throw new Error("Customer exports must be outside the Git checkout");
const digest = createHash("sha256").update(readFileSync(snapshot)).digest("hex");
const stamp = `${database}.sha256`;
if (!existsSync(database) || !existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== digest) {
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  if (existsSync(database)) backupDatabase(database, join(dirname(dirname(database)), "backups", `glacier-${Date.now()}.sqlite`));
  await seedGlacierSnapshot(snapshot, database);
  writeFileSync(`${stamp}.tmp`, digest + "\n", { mode: 0o600 });
  renameSync(`${stamp}.tmp`, stamp);
  console.log("Private Glacier snapshot refreshed atomically. Restart its service to use the new snapshot.");
}
