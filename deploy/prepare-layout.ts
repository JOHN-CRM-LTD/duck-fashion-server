// Called while the old Duck service is stopped by install-layout.sh.
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { backupDatabase } from "./backup.js";
import { readDuckManagers } from "../server/manager-directory.js";
import { browseLocationDirectory } from "../server/location-directory.js";
import { seedGlacierSnapshot } from "../server/glacier-seed.js";

const sourcePath = resolve(process.argv[2] ?? ".local-duck/live-connection.json");
const root = resolve(process.argv[3] ?? "/srv");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
if (source.glacierSeparate) throw new Error("Already split; inspect existing layout instead of copying it again");
if (![source.apiKey, source.writeApiKey, source.glacierApiKey].every(key => typeof key === "string" && /^[a-f0-9]{64}$/.test(key))) throw new Error("Valid existing Duck read/write and Glacier keys are required; no credentials will be rotated");
const duckRoot = join(root, "duck-fashion"), glacierRoot = join(root, "glacier");
if (existsSync(duckRoot) || existsSync(glacierRoot)) throw new Error("Destination already exists. Review it; migration never overwrites an existing deployment");
const dbPath = join(source.dataDirectory, "duck-fashion.sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });
let managerMismatch = false;
try {
  const locations = [];
  for (let offset = 0; ; offset += 50) {
    const page = browseLocationDirectory(db, offset, 50); locations.push(...page.locations);
    if (!page.hasMore) break;
  }
  const managers = readDuckManagers(source.managerDirectoryPath).managers;
  managerMismatch = managers.some(manager => {
    const location = locations.find(row => row.inventoryLocationId === manager.shopId);
    return !location || location.managerPhone !== manager.phone || location.managerName !== manager.name;
  });
} finally { db.close(); }
// Ambiguous assignments need an explicit edit before cutover. Do not silently choose.
if (managerMismatch) throw new Error("Manager directory and CRM location records disagree. Reconcile them before migration; no files were moved");
for (const base of [duckRoot, glacierRoot]) for (const name of ["config", "data", "backups"]) mkdirSync(join(base, name), { recursive: true, mode: 0o700 });
const writePrivate = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const { glacierApiKey, managerDirectoryPath, ...duck } = source;
writePrivate(join(duckRoot, "backups", "pre-split-connection.json"), duck);
writePrivate(join(glacierRoot, "backups", "pre-split-connection.json"), { glacierApiKey });
backupDatabase(dbPath, join(duckRoot, "backups", "pre-split.sqlite"));
backupDatabase(dbPath, join(duckRoot, "data", "duck-fashion.sqlite"));
if (existsSync(join(source.dataDirectory, "images"))) cpSync(join(source.dataDirectory, "images"), join(duckRoot, "data", "images"), { recursive: true, errorOnExist: true });
const managerPath = resolve(source.managerDirectoryPath ?? ".local-duck/managers.json");
if (existsSync(managerPath)) cpSync(managerPath, join(duckRoot, "backups", "pre-split-managers.json"));
writePrivate(join(duckRoot, "config", "connection.json"), {
  ...duck, glacierSeparate: true, dataDirectory: join(duckRoot, "data"), backupDirectory: join(duckRoot, "backups"),
  staffReadApiKey: source.staffReadApiKey ?? randomBytes(32).toString("hex"),
  adminApiKey: source.adminApiKey ?? randomBytes(32).toString("hex"),
});
const glacierDb = join(glacierRoot, "data", "glacier-icerink.sqlite");
if (existsSync(join(source.dataDirectory, "glacier-icerink.sqlite"))) backupDatabase(join(source.dataDirectory, "glacier-icerink.sqlite"), glacierDb);
else await seedGlacierSnapshot(resolve("data/glacier-icerink.tsv.gz"), glacierDb);
writePrivate(join(glacierRoot, "config", "connection.json"), { port: 4998, apiKey: glacierApiKey, databasePath: glacierDb });
console.log("Prepared separate Duck Fashion and Glacier directories. Original data/config preserved; no secrets printed.");
