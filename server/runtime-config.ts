import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const duckConfigPath = () => resolve(process.env.DUCK_CONFIG ?? ".local-duck/live-connection.json");
export const readDuckConfig = () => JSON.parse(readFileSync(duckConfigPath(), "utf8"));
