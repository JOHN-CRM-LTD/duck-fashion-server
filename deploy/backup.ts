import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readDuckConfig, duckConfigPath } from "../server/runtime-config.js";

export function backupDatabase(source: string, target: string) {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.exec("PRAGMA busy_timeout=10000"); db.prepare("VACUUM INTO ?").run(target); }
  finally { db.close(); }
  chmodSync(target, 0o600);
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/backup.ts")) {
  const config = readDuckConfig();
  const directory = config.backupDirectory ?? join(dirname(duckConfigPath()), "backups");
  backupDatabase(join(config.dataDirectory, "duck-fashion.sqlite"), join(directory, `duck-${Date.now()}-${randomUUID()}.sqlite`));
  console.log("Consistent Duck database backup created; source database preserved.");
}
