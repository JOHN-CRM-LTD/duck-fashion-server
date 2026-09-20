# Duck Fashion demo stock service — server setup

> Hosting on a Raspberry Pi? Follow **PI-SETUP.md** — it is the step-by-step
> version of this document for a Pi at home, including the Cloudflare tunnel.

This bundle runs the **Duck Fashion** demo catalog that the John CRM live
workspace (workspace 71) uses for product details, shop stock and
reservations. It is one small Node.js service plus a single-file SQLite
database. Reservations themselves live in John CRM; this service only serves
catalog/stock data and accepts idempotent stock adjustments from CRM.

## Two questions you asked, answered first

**"Send us a .bak"** — There is no .bak because this is not SQL Server.
The database is **SQLite**: one portable file, `data\duck-fashion.sqlite`
(about 170 KB). SQLite has no server process and no backup/restore tooling —
the file *is* the database and *is* the backup. To "restore", put the file
back in `data\`. `data\schema.sql` is included for reference only; the
database file already contains the schema and all 216 stock rows.

(An older, disconnected version of this demo did use SQL Server in Docker,
which is likely where the .bak idea came from. That path is retired — please
use this SQLite service.)

**"What does it compile to / where is the .exe"** — Nothing compiles. There
is no .exe and no build step. The service is TypeScript source
(`server\capsule-api.ts`) executed directly by **Node.js** via the `tsx`
loader, which `npm install` provides. The only .exe in the old laptop setup
was `cloudflared.exe` (a Cloudflare tunnel used because a laptop has no
public address). On a real server you do **not** need the tunnel — terminate
HTTPS on your own reverse proxy and forward to `127.0.0.1:4997`.

## What you need on the server

- **Node.js 22.13 or newer** (22 LTS or 24.x both fine) — nothing else.
  `node:sqlite` is built into Node; **no database server, no Docker, no
  compiler, no native modules** are required.
- About 50 MB RAM and a few MB of disk.
- A reverse proxy with a TLS certificate (nginx, Caddy, IIS, …) if you want
  HTTPS, which you should — the service itself speaks plain HTTP on loopback
  by design.

## Setup

1. Copy this folder to the server, e.g. `C:\duck-fashion-server`.
2. Install Node.js 22.13+ (or verify: `node --version`).
3. Install dependencies (creates `node_modules`, needs internet once):

   ```powershell
   cd C:\duck-fashion-server
   npm install
   ```

4. Create the runtime config. The service reads
   `.local-duck\live-connection.json` **relative to the folder you start it
   from** (the folder containing `package.json`):

   ```powershell
   copy .local-duck\live-connection.example.json .local-duck\live-connection.json
   notepad .local-duck\live-connection.json
   ```

   Generate two keys (each must be exactly 64 lowercase hex characters —
   the service refuses to start otherwise):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   | Field | Meaning |
   | --- | --- |
   | `mode` | Must stay `"capsule"`. |
   | `port` | Must stay `4997` (the service enforces this). |
   | `apiKey` | Read credential John CRM sends as `Authorization: Bearer <key>`. |
   | `writeApiKey` | Optional second key required for `POST /stock/adjust`. Omit or remove the line to disable stock writes. |
   | `dataDirectory` | Absolute path to the `data` folder, e.g. `C:/duck-fashion-server/data` (forward slashes are fine). |
   | `url` | The **public HTTPS base URL** customers' image URLs are built from, e.g. `https://duck.example.com` or `https://duckserver.johncrm.com/stock-api`. A proxy path prefix is preserved; a trailing slash is optional. Must match what the reverse proxy serves. No embedded credentials, query or fragment. |

5. Start it and confirm it is listening on loopback only:

   ```powershell
   npm start
   # in a second shell:
   curl -H "Authorization: Bearer <apiKey>" "http://127.0.0.1:4997/inventory?query=hoodie"
   ```

6. Put it behind your proxy. nginx example:

   ```nginx
   location /duck/ {
       proxy_pass http://127.0.0.1:4997/;
       proxy_set_header Authorization $http_authorization;
       proxy_read_timeout 30s;
   }
   ```

   IIS: a reverse-proxy rule (ARR) to `http://127.0.0.1:4997/` works the
   same way. **Do not open port 4997 on the firewall and do not change the
   service to bind a public interface** — it has no TLS and relies on the
   proxy for encryption.

7. Run it as a service so it survives reboots:
   - Windows: NSSM (`nssm install DuckFashion "C:\Program Files\nodejs\node.exe" "--import tsx C:\duck-fashion-server\server\capsule-api.ts"`, with the working directory set to `C:\duck-fashion-server`), Windows Task Scheduler at startup, or `pm2`.
   - Linux: a systemd unit with `WorkingDirectory=/opt/duck-fashion-server`, `ExecStart=/usr/bin/node --import tsx server/capsule-api.ts`.

## API summary

All endpoints except the whitelisted images require a Bearer credential.
Use `apiKey` for ordinary reads and `staffReadApiKey` for private manager/location
reads. `writeApiKey` is reserved for Pi-side staff administration; never give it
to John CRM.

| Method & path | Purpose |
| --- | --- |
| `GET /products?query=...&offset=0` | Product definitions grouped by style (all 8 items). |
| `GET /inventory?query=...` | Live stock rows per SKU and shop, with optimistic-concurrency `stockVersion`. |
| `GET /shops` | The three demo shops (PCL, PCB, SH015). |
| `POST /stock/adjust` | Staff stock adjustment. Requires the **write** key. Idempotent by `requestId`; rejects stale `expectedVersion` with `409 STOCK_CONFLICT`. |
| `GET /bonus/balance?member=...&phone=...` | Points for an exact member ID and matching registered full international phone. Missing or mismatched identity returns 403 without candidate information. |
| `GET /bonus/redeemables?member=...&phone=...` | Rewards catalog; personal affordability requires the same member ID/phone pair. Omit both for the generic catalog. |
| `GET /managers` | Staff-only shop manager directory, using the separate read-only `staffReadApiKey`. A private managers.json provides the Pi-owned assignments. Never give CRM the write key. |
| `GET /shops?mode=locations&offset=0&limit=50` | Staff-only location directory, using `staffReadApiKey`; returns `locations`, `hasMore`, `revision`. Includes Pi-owned address/manager details. See [finalization](docs/finalize-johncrm.md). |
| `GET /bonus/cash-scheme` | The Bonus-as-Cash conversion scheme: base ratio and tier table. |
| `GET /customers/lookup?phone=...` / `POST /customers/import` | Existing-customer matching against the shared member table — see [CUSTOMER-MATCHING.md](CUSTOMER-MATCHING.md). |
| `GET /customers/lookup?mode=browse&offset=0&limit=50` | Authenticated staff Users source: bounded customer pages with current ledger-derived `membershipPoints`, excluding archived accounts. CRM's Knowledge Base directory must stay staff-only. |
| `GET /images/<file>.png` | Only the whitelisted product photos (30 files, all three colours) are served; everything else 404s. |

## Backup and restore

- **Backup**: use SQLite's backup API for a consistent snapshot of the running
  database, or stop every writer and checkpoint before copying it. Never copy
  only the live main file while ignoring its WAL. Store backups and private
  configuration/manager files in a restricted directory outside Git.
- **Restore**: stop all writers and the updater, preserve the current database and
  sidecars, then restore the consistent snapshot without reusing stale WAL/SHM
  files. Verify integrity, counts and permissions before restarting and resuming
  the updater. Editing catalogue JSON does not edit the live database.
- The service keeps its own audit trail of adjustments in the `stock_changes`
  table inside the same file.

## Security notes

- Keep the ordinary read, staff read and staff write keys distinct. Keep
  `.local-duck\live-connection.json` out of shared backups and source control.
  Coordinate read-key rotations with CRM's encrypted endpoint credentials and
  restart the service. A write-key rotation affects Pi-side staff tools only;
  it must never add write access to CRM.
- The service binds `127.0.0.1` only, sets `no-store` on API responses, and
  never exposes the database, JSON exports or config over HTTP.
- Nothing in this bundle phones home; the only outbound dependency is none —
  the Cloudflare tunnel from the laptop setup is not included and not needed.

## After the server is running (CRM side — we do this)

Connect and activate the existing inventory, customer and loyalty endpoints, plus
the staff-only location source, using [the finalization guide](docs/finalize-johncrm.md).
Shop master data and manager details live on the Pi. Duck's chats stay on
DigitalOcean with the last 20 messages per chat. Existing reservations and other
historical business data need their own migration/cleanup; do not bypass residency
guards or claim that changing an endpoint has moved those records.

For a Duck Console deployment with its stock proxy enabled, use
`https://duckserver.johncrm.com/stock-api` as this service's runtime `url` and the
prefix for standalone CRM endpoints. Integration bundles require origin-only
`baseUrl` (`https://duckserver.johncrm.com`) and `/stock-api/...` request paths.
The proxy must strip `/stock-api` when forwarding
to `127.0.0.1:4997`, including image requests, and preserve the caller's
Bearer credential. The console's root URL and login password are not the
stock API URL or credential. Verify the proxy is deployed before switching
CRM, then restart the stock service after changing its runtime `url`.

## Folder map

```
duck-fashion-server\
├─ server\capsule-api.ts      HTTP service (Express), entry point
├─ server\capsule-store.ts    SQLite data access, adjustment logic
├─ server\capsule-catalog.ts  Static catalog definitions (8 items)
├─ data\duck-fashion.sqlite   THE database (single file; also the ".bak")
├─ data\schema.sql            Schema reference
├─ data\catalog.json          Human-readable catalog export (reference)
├─ data\availability-matrix.json  Source-stock snapshot (reference)
├─ data\images\               Product photos, all three colours (only whitelisted ones served)
├─ data\catalog.html          Standalone visual catalog (reference)
├─ .local-duck\live-connection.example.json  Config template
├─ deploy\                    systemd units + config generator for self-hosting (see PI-SETUP.md)
├─ DEMO-README.md             Original demo/collection documentation
├─ PI-SETUP.md                Step-by-step Raspberry Pi hosting guide
└─ SERVER-SETUP.md            This file
```
