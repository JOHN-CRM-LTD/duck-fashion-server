import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { migrateLocationDirectory, importLocationDirectory } from "./location-directory.js";
import { readDuckManagers } from "./manager-directory.js";

const config = JSON.parse(readFileSync(resolve(".local-duck/live-connection.json"), "utf8"));
const dbPath = join(config.dataDirectory, "duck-fashion.sqlite");
if (!existsSync(dbPath)) throw new Error("Seed the source database first");
const input = process.argv[2];
if (!input) throw new Error("Provide a private JSON array file, or --demo for the existing three fictional shops");
const db = new DatabaseSync(dbPath);
try {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  migrateLocationDirectory(db);
  const managers = input === "--demo" ? readDuckManagers(config.managerDirectoryPath).managers : [];
  const demoNames = ["Causeway Bay Store", "Central Store", "Jumbo Sogo"];
  const rows = input === "--demo" ? ["PCB", "PCL", "SH015"].map((inventoryLocationId, index) => {
    const manager = managers.find(row => row.shopId === inventoryLocationId);
    if (!manager) throw new Error("The demo manager directory is incomplete");
    return { id: index + 1, inventoryLocationId, name: `${demoNames[index]} — demo pickup location`,
      addressLine1: `Demo pickup point ${inventoryLocationId} — no real street address configured`, locality: index === 1 ? "Central" : "Causeway Bay",
      country: "HK", timezone: "Asia/Hong_Kong", managerName: manager.name, managerPhone: manager.phone,
      hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(day => [day, [{ open: "10:00", close: "20:00" }]])),
      isActive: true, acceptsReservations: true };
  }) : JSON.parse(readFileSync(resolve(input), "utf8"));
  const result = importLocationDirectory(db, rows);
  console.log(`Validated ${result.imported} source locations. Existing different records were not overwritten.`);
} finally { db.close(); }
