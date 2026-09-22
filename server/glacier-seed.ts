/**
 * Rebuilds data/glacier-icerink.sqlite from the committed IceRink snapshot
 * (data/glacier-icerink.tsv.gz, produced by johncrm/glacier-api's
 * scripts/export-icerink-snapshot.ts from the SQL Server .bak restore).
 *
 * The snapshot is a gzipped TSV: `# table`/`# columns` section headers, then one row per
 * line with `\N` for NULL and `\\`, `\t`, `\n`, `\r` escapes. Every value was RTRIMmed at
 * export (SQL Server ignores trailing spaces in comparisons; SQLite does not) and datetimes
 * are HK wall-clock `YYYY-MM-DDTHH:MM:SS.mmm` text. Only the columns the read contract
 * queries are present — no addresses, e-mail, HKID or birth dates.
 *
 * Usage: npm run seed:glacier   (run from the bundle root)
 */
import { createReadStream, existsSync, renameSync, unlinkSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const NULL_SENTINEL = "\u0000NULL";
/** Columns bound as numbers (everything else is text); key columns stay text. */
const NUMERIC_COLUMNS: Record<string, Set<string>> = {
  course_student: new Set(["line_no", "tot_lesson", "con_lesson", "bal_lesson"]),
  book_coach: new Set(["line_no"]),
  trx_hdr_bk: new Set(["total_amt", "recv_amt", "chg_amt"]),
  trx_payment_bk: new Set(["pay_bas_amt"]),
};
const INDEXES: string[] = [
  "CREATE INDEX idx_member_code ON member_info(mbr_code)",
  "CREATE INDEX idx_member_mobile ON member_info(mbr_mobile)",
  "CREATE INDEX idx_course_no ON course(course_no)",
  "CREATE INDEX idx_course_expire ON course(expire_date)",
  "CREATE INDEX idx_cs_mbr ON course_student(mbr_code)",
  "CREATE INDEX idx_cs_course_mbr ON course_student(course_no, mbr_code)",
  "CREATE INDEX idx_showup_course_mbr ON course_showup(course_no, mbr_code)",
  "CREATE INDEX idx_showup_bk ON course_showup(bk_no)",
  "CREATE INDEX idx_book_bk ON book_info(bk_no)",
  "CREATE INDEX idx_book_course ON book_info(course_no)",
  "CREATE INDEX idx_book_date ON book_info(bk_date)",
  "CREATE INDEX idx_coach_bk ON book_coach(bk_no)",
  "CREATE INDEX idx_trxhdr_trx ON trx_hdr_bk(trx_no)",
  "CREATE INDEX idx_trxhdr_mbr ON trx_hdr_bk(mbr_code)",
  "CREATE INDEX idx_trxhdr_updated ON trx_hdr_bk(updated_on)",
  "CREATE INDEX idx_trxpay_trx ON trx_payment_bk(trx_no)",
];

function decodeFields(line: string): (string | null)[] {
  const fields: (string | null)[] = [];
  let current = "";
  let escaped = false;
  for (const ch of line) {
    if (escaped) {
      current += ch === "t" ? "\t" : ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "N" ? NULL_SENTINEL : ch;
      escaped = false;
    } else if (ch === "\\") escaped = true;
    else if (ch === "\t") { fields.push(current === NULL_SENTINEL ? null : current); current = ""; }
    else current += ch;
  }
  fields.push(current === NULL_SENTINEL ? null : current);
  return fields;
}

export interface GlacierSeedResult { tables: Record<string, number>; dataAsOf: string; exportedAt: string }

/** Streams the snapshot into a fresh SQLite database, then atomically replaces `outPath`. */
export async function seedGlacierSnapshot(snapshotPath: string, outPath: string): Promise<GlacierSeedResult> {
  if (!existsSync(snapshotPath)) throw new Error(`Snapshot ${snapshotPath} not found.`);
  const tempPath = `${outPath}.tmp`;
  if (existsSync(tempPath)) unlinkSync(tempPath);
  const db = new DatabaseSync(tempPath);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");
  const result: GlacierSeedResult = { tables: {}, dataAsOf: "", exportedAt: "" };
  let table = "", columns: string[] = [], insert: StatementSync | null = null;
  let numeric = new Set<string>(), pending: unknown[][] = [], rowCount = 0;
  const flush = () => {
    if (!insert || !pending.length) return;
    db.exec("BEGIN");
    try {
      for (const row of pending) insert.run(...row);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    pending = [];
  };
  try {
    const lines = createInterface({ input: createReadStream(snapshotPath).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.startsWith("#")) {
        const [marker, ...rest] = line.slice(2).split(" ");
        if (marker === "table") {
          flush();
          if (table && insert) result.tables[table] = rowCount;
          table = rest[0] ?? "";
          columns = [];
          insert = null;
        } else if (marker === "columns") {
          columns = (rest[0] ?? "").split(",").filter(Boolean);
          db.exec(`CREATE TABLE ${table} (${columns.map(column => `"${column}"`).join(",")})`);
          insert = db.prepare(`INSERT INTO ${table} VALUES (${columns.map(() => "?").join(",")})`);
          numeric = NUMERIC_COLUMNS[table] ?? new Set<string>();
          rowCount = 0;
        } else if (marker === "dataAsOf") result.dataAsOf = rest[0] ?? "";
        else if (marker === "exportedAt") result.exportedAt = rest[0] ?? "";
        continue;
      }
      if (!line || !insert) continue;
      pending.push(decodeFields(line).map((field, index) => {
        if (field === null) return null;
        return numeric.has(columns[index] ?? "") ? Number(field) : field;
      }));
      rowCount++;
      if (pending.length >= 5_000) flush();
    }
    flush();
    result.tables[table] = rowCount;
    for (const index of INDEXES) db.exec(index);
    db.exec("CREATE TABLE _glacier_meta (key TEXT PRIMARY KEY, value TEXT)");
    const put = db.prepare("INSERT INTO _glacier_meta (key, value) VALUES (?, ?)");
    put.run("dataAsOf", result.dataAsOf);
    put.run("exportedAt", result.exportedAt);
    put.run("snapshot", snapshotPath);
    put.run("seededAt", new Date().toISOString().slice(0, 23));
    for (const [name, count] of Object.entries(result.tables)) put.run(`rows.${name}`, String(count));
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA optimize;");
  } finally {
    db.close();
  }
  renameSync(tempPath, outPath);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDirectory = resolve("data");
  const started = Date.now();
  const result = await seedGlacierSnapshot(join(dataDirectory, "glacier-icerink.tsv.gz"), join(dataDirectory, "glacier-icerink.sqlite"));
  for (const [name, count] of Object.entries(result.tables)) console.log(`${name}: ${count} rows`);
  console.log(`dataAsOf ${result.dataAsOf || "(none)"} — seeded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
