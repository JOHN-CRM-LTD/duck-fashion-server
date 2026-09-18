import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({ managers: z.array(z.object({ shopId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160), phone: z.string().regex(/^\+[1-9]\d{7,14}$/) })).max(1000) });
/** User-approved demo contacts. A private deployment file can replace them. */
export const DEMO_MANAGERS = { managers: [
  { shopId: "PCB", name: "PCB shop manager", phone: "+85296540199" },
  { shopId: "PCL", name: "PCL shop manager", phone: "+85296540199" },
  { shopId: "SH015", name: "Jumbo Sogo shop manager", phone: "+85296540199" },
] };
export function readDuckManagers(path = resolve(".local-duck/managers.json")) {
  const result = schema.parse(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : DEMO_MANAGERS);
  if (new Set(result.managers.map(m => m.shopId)).size !== result.managers.length) throw new Error("Duplicate manager shop IDs");
  return result;
}
