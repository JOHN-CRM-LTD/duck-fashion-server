# Glacier IceRink read API (`/glacier`)

The Glacier Skating booking system's SQL Server database, restored from the
rink's backup (`IceRink_2026.07.30.bak`), served read-only from this same
service so the John CRM Glacier workspace automations can run against the
Pi endpoint `https://duckserver.johncrm.com/glacier` instead of a laptop
SQL Server tunnel.

```
John CRM (glacier workspace automations)
   │  Bearer glacierApiKey
   ▼
Cloudflare edge ── duckserver.johncrm.com ── cloudflared (Pi) ── 127.0.0.1:4997
   /glacier/v1/students · /v1/packages · /v1/lessons · /v1/tuition-payments
   /glacier/v1/customer-context · /glacier/v1/students/{id}/automation-context
   /glacier/health (open)
   ▼
data/glacier-icerink.sqlite  (seeded from data/glacier-icerink.tsv.gz)
```

- **Read-only.** Booking writes (top-up, refund, booking create/cancel/settle)
  are not part of this snapshot; they stay on the disposable SQL Server clone
  workflow in `johncrm/glacier-api`.
- **A snapshot, not a feed.** `dataAsOf` is 2026-07-30 (the .bak date) and every
  response says so in `source`. Refreshing means re-exporting and redeploying
  (below).
- **PII-minimised.** Only the columns the read contract queries left SQL
  Server — no addresses, e-mail, HKID or birth dates. Names, mobile numbers
  and tuition amounts are present because the contract serves them.
- **Parity-proven.** The SQLite port returns byte-identical JSON to the
  reference `glacier-api` adapter reading SQL Server over TDS: the recorded
  2026-07-31 benchmark (262 seats / 153 classes / 242 students), full walks of
  all 60,499 students, 5,858 July lessons and 2,491 June–July payments, mobile
  lookups, package counters, payment classification and both context routes.

## Files

| File | Role |
| --- | --- |
| `data/glacier-icerink.tsv.gz` | The committed 25 MB snapshot (gzipped TSV, one section per table) |
| `server/glacier-seed.ts` | `npm run seed:glacier` — rebuilds `data/glacier-icerink.sqlite` from the snapshot (≈13 s on a laptop, a few minutes on the Pi) |
| `server/glacier/sqlite-provider.ts` | The read contract's queries against SQLite (`node:sqlite`, built into Node 22.13+) |
| `server/glacier/router.ts` | Routes, query validation, bearer auth — semantics copied from the reference adapter |
| `server/glacier/mapping.ts`, `provider-core.ts`, `contract.ts` | Shared with `johncrm/glacier-api` (mobile normalisation, row mappers, cursors) |
| `deploy/enable-glacier.sh` | One-time Pi switch-on: seed + generate `glacierApiKey` + print it |

The SQLite database is derived data: gitignored, rebuilt from the committed
snapshot, and never carries live edits — unlike `duck-fashion.sqlite`, which
holds live stock. `deploy/pull-update.sh` re-seeds it automatically when a
`glacierApiKey` is configured and the database is missing.

## Switching it on (once, on the Pi)

```bash
cd ~/Documents/duck-fashion-server   # or wherever the checkout lives
bash deploy/enable-glacier.sh        # seeds if needed, generates + prints the glacier key
sudo systemctl restart duck-fashion
curl -s http://127.0.0.1:4997/glacier/health
```

Then in John CRM, point the Glacier integration's base URL at
`https://duckserver.johncrm.com/glacier` and set its `api_token` credential to
the printed key (the manifest in `johncrm/glacier-api/docs/johncrm-manifest.json`
already describes these operations; set its `baseUrl` to the same value).
Until `glacierApiKey` exists in `.local-duck/live-connection.json`, the
service boots exactly as before — deploying this code with the glacier API
disabled changes nothing for the stock endpoints.

## Refreshing the data (a newer .bak)

On a machine with Docker and the .bak:

```bash
# restore into the johncrm-duck-sql container (mounts Desktop/SE_TEST as /backup), then:
cd johncrm/glacier-api
GLACIER_EXPORT_SQL_PASSWORD=<sa password> npx tsx scripts/export-icerink-snapshot.ts \
  --out ../../duck-fashion-server/data/glacier-icerink.tsv.gz
```

Commit the new snapshot, push, and on the Pi run
`rm data/glacier-icerink.sqlite && sudo systemctl start duck-fashion-update`
(the updater re-seeds, restarts and health-checks `/glacier/health`; it rolls
back automatically if the service does not come up).

## Conventions that keep parity

- Values are RTRIMmed at export: SQL Server ignores trailing spaces in
  comparisons, SQLite does not (`bk_status` is `nchar(2)`).
- Datetimes are Hong Kong wall-clock text `YYYY-MM-DDTHH:MM:SS.mmm`
  (lexicographic order equals chronological order) hydrated into UTC-flagged
  Dates, matching the mssql `useUTC` convention the shared mappers assume.
- `source.mode` stays `"sql"`; the CRM contract has no `sqlite` member and the
  snapshot is a SQL database image.
