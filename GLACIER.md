# Glacier IceRink read API (`/glacier`)

A small, referentially closed sample of the Glacier Skating booking database
(from the rink's `IceRink_2026.07.30.bak` backup), served read-only from this
same service so the John CRM Glacier workspace automations can run against a
Raspberry Pi endpoint instead of a laptop SQL Server tunnel.

**Sample contents** (regenerated deterministically by the exporter): 30
students, 5 coaches, 543 enrolments over 419 courses, 501 seats in 359
classes (2026, coached only by the 5), and 140 SA5 sales with their tender
lines. Every sampled student holds a pending seat in a live class on the
2026-07-31 benchmark day, has at most 40 active enrolments (so every
customer context fits the 100-package bound), and the student pick goes
round-robin across the coaches so all five appear in the exported bookings.
Seats outside the 2026 coach-clean window are intentionally absent, so older
packages report `ENTITLEMENT_UNVERIFIED` — the contract's honest signal,
not an error.

```
John CRM (glacier workspace automations)
   │  Bearer glacierApiKey
   ▼
https://glacier.johncrm.com/glacier/v1/...   (Cloudflare edge → cloudflared
   │                                          tunnel running ON the Pi)
   ▼
127.0.0.1:4997/glacier/v1/students · /v1/packages · /v1/lessons · /v1/tuition-payments
               /glacier/v1/customer-context · /glacier/v1/students/{id}/automation-context
               /glacier/health (open, unauthenticated)
   ▼
data/glacier-icerink.sqlite  (seeded from data/glacier-icerink.tsv.gz)
```

The endpoint is reached through the Pi's own Cloudflare tunnel — no
DigitalOcean involvement: nothing is stored there and no proxy there is in
the path. (The shared `/stock-api` nginx proxy stays for the stock API and
is deliberately not used for glacier.)

- **Read-only.** Booking writes (top-up, refund, booking create/cancel/settle)
  are not part of this snapshot; they stay on the disposable SQL Server clone
  workflow in `johncrm/glacier-api`.
- **A snapshot, not a feed.** `dataAsOf` is 2026-07-30 (the .bak date) and every
  response says so in `source`. Refreshing means re-exporting and redeploying
  (below).
- **Small and bounded.** ~65 KB compressed, 2,595 rows; the seed takes under a
  second on a laptop and a few seconds on the Pi. The exporter takes only the
  columns the read contract queries — no addresses, e-mail, HKID or birth
  dates leave SQL Server.
- **Contract-faithful.** The SQLite provider is a port of the reference
  adapter's queries; it returned byte-identical JSON to the reference
  `glacier-api` adapter reading SQL Server over TDS during development
  (benchmark day, full walks of students/lessons/payments, mobile lookups,
  package counters, both context routes).

## Files

| File | Role |
| --- | --- |
| `data/glacier-icerink.tsv.gz` | The committed snapshot (gzipped TSV, one section per table) |
| `server/glacier-seed.ts` | `npm run seed:glacier` — rebuilds `data/glacier-icerink.sqlite` from the snapshot |
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

Give the Pi its own stable public address with a **named** Cloudflare tunnel
(the quick tunnel's URL changes on every restart). On the Pi:

```bash
cloudflared tunnel login                    # authorise the johncrm.com zone
cloudflared tunnel create glacier
sudo cloudflared tunnel route dns glacier glacier.johncrm.com
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: <tunnel-uuid-from-create>
credentials-file: /home/pi/.cloudflared/<tunnel-uuid-from-create>.json
ingress:
  - hostname: glacier.johncrm.com
    service: http://127.0.0.1:4997
  - service: http_status:404
EOF
sudo cloudflared service install && sudo systemctl restart cloudflared
curl -s https://glacier.johncrm.com/glacier/health
```

(Any hostname in the zone works; `glacier.johncrm.com` is just the example.
If the Pi already runs a named tunnel for another purpose, add the ingress
rule to it instead of creating a second one.)

Then in John CRM, use the generated manifest
`johncrm/glacier-api/docs/johncrm-manifest-duckserver.json` — its request
paths carry the `/glacier` prefix, because JohnCRM forbids a path inside
`baseUrl`: set the integration's base URL to the origin only
(`https://glacier.johncrm.com`) and its `api_token` credential to the printed
key. Renewal / payment / lesson reminder / lesson change templates are fully
served; booking templates need the write-clone adapter and stay local.

Until `glacierApiKey` exists in `.local-duck/live-connection.json`, the
service boots exactly as before — deploying this code with the glacier API
disabled changes nothing for the stock endpoints.

## Refreshing the data (a newer .bak)

On a machine with Docker and the .bak:

```bash
# restore into the johncrm-duck-sql container (mounts Desktop/SE_TEST as /backup), then:
cd johncrm/glacier-api
GLACIER_EXPORT_SQL_PASSWORD=<sa password> npx tsx scripts/export-icerink-snapshot.ts \
  --out ../../duck-fashion-server/data/glacier-icerink.tsv.gz \
  --sample-students 30 --sample-coaches 5
```

Omit the `--sample-*` flags for a full-population export (~25 MB; every
customer context then depends on each student's package count). Commit the
new snapshot, push, and on the Pi run
`rm data/glacier-icerink.sqlite && sudo systemctl start duck-fashion-update`
(the updater re-seeds, restarts and health-checks `/glacier/health`; it rolls
back automatically if the service does not come up). Drop the restored SQL
database afterwards — it is tens of GB and only needed for the export.

## Conventions that keep parity

- Values are RTRIMmed at export: SQL Server ignores trailing spaces in
  comparisons, SQLite does not (`bk_status` is `nchar(2)`).
- Datetimes are Hong Kong wall-clock text `YYYY-MM-DDTHH:MM:SS.mmm`
  (lexicographic order equals chronological order) hydrated into UTC-flagged
  Dates, matching the mssql `useUTC` convention the shared mappers assume.
- `source.mode` stays `"sql"`; the CRM contract has no `sqlite` member and the
  snapshot is a SQL database image.
