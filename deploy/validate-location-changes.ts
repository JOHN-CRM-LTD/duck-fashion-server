import { readFileSync } from "node:fs";
import { gitLocationChangesSchema } from "../server/location-admin.js";
const rows = gitLocationChangesSchema.parse(JSON.parse(readFileSync("config/duck-fashion/location-changes.json", "utf8")));
if (new Set(rows.map(row => row.requestId)).size !== rows.length) throw new Error("Duplicate location change request IDs");
console.log(`Validated ${rows.length} reviewed location changes. Live revision checks run on the Pi.`);
