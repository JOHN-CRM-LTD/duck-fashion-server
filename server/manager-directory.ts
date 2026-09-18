import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({ managers: z.array(z.object({ shopId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160), phone: z.string().regex(/^\+[1-9]\d{7,14}$/) })).max(1000) });
/** Operator-maintained fixture, never product data or invented contact numbers. */
export function readDuckManagers(path = resolve(".local-duck/managers.json")) {
  const result = schema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (new Set(result.managers.map(m => m.shopId)).size !== result.managers.length) throw new Error("Duplicate manager shop IDs");
  return result;
}
