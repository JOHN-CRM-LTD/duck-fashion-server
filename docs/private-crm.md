# Private Duck CRM and the business API

The stock service in this repository is the **business data source**. It does not
store CRM conversations, messages, reservations, attachments or sessions. To keep
all company data on the enterprise server, run the John CRM application and its
own PostgreSQL database alongside this service. The application reads this API;
it does not receive a credential that can edit the business database.

## Locations on the Pi

Run these commands in the Pi checkout, after reviewing/deploying this branch:

```sh
node deploy/create-staff-read-key.mjs
node --import tsx server/import-locations.ts --demo
sudo systemctl restart duck-fashion.service
```

`--demo` fills the three fictional shops from the existing shop codes and the
Pi's current manager directory. It does not change manager assignments, stock,
customers or different existing location records. For an enterprise with 300
shops, pass a private JSON array file instead. Their API can implement the same
contract directly without any manual entry in CRM. Never commit a real directory.

Configure a staff-only Knowledge Base endpoint in the **private CRM**:

- GET `https://duckserver.johncrm.com/stock-api/shops?mode=locations`.
- Bearer credential: `staffReadApiKey` from the private configuration file.
  This key has no stock-adjustment/customer-import permission. Do not use `writeApiKey`.
- Declared numeric query inputs: `offset`, `limit`.
- Approved output fields: `locations`, `hasMore`, `revision`.
- Global Admin location mappings use those same field names.
- Pages contain up to 50 validated shops. `revision` fingerprints the directory;
  the CRM rejects a directory that changes while paging. There is no cached
  fallback on the shared John CRM server.

Fields and validation live in `server/location-contract.ts`. In addition to the
existing address, timezone, opening hours and manager fields, each shop supplies
a stable positive numeric `id`, stable `inventoryLocationId`, and
`acceptsReservations`. Reservation acceptance defaults to false. Private manager
phones are operational details and must not be published in a customer endpoint.

## Private application deployment

Use the John CRM repository's `deploy/enterprise/compose.yml`, Dockerfile,
`private.env.example` and `scripts/enterprise-bind.ts`. The application is a
separate deployment, listening on Pi loopback port 4996; the business API remains
on 4997. It requires 64-bit Linux and a working Docker installation; the stock
service alone still works without Docker. Verify Pi architecture, available RAM,
disk and the container's ARM64 build before cutover.

Give the private application its own HTTPS hostname and tunnel ingress to
`http://127.0.0.1:4996`. Keep the existing stock API/console ingress intact.
Point all CRM webhooks, embedded chat, public links and OAuth callbacks at that
private origin. The browser loads both the UI and `/api` from the private origin.
Do not proxy private `/api` traffic through John CRM's shared application.

The private database stores the enterprise's operational records and files.
Source shops are projected there automatically for existing reservation foreign
keys, using stable business shop codes to preserve migrated references. That
projection is never written to the shared John CRM database. The UI remains
read-only for business records; User Types and Spaces are hidden. Internal
staff/customer endpoint access restrictions remain enforced.

## Cutover is separate from the stock API updater

`duck-fashion-update.timer` deploys this repository's `main` automatically. It
does **not** provision or migrate the private CRM. Do not interpret a successful
`/shops` health check as proof of CRM data residency.

Before switching traffic, transfer only Duck's records and attachments to its
private database, verify counts and referenced files, bind the database to
Duck's public workspace ID, and test private startup with real customer-facing
workers disabled. Use a maintenance window to drain pending sends and move
channel/webhook ownership exactly once. A full shared-platform database dump
must never be restored on an enterprise server.

After private operation is verified, review removal/retention of the previous
shared rows, object-storage blobs, logs and backups. A source setting alone does
not erase them. Source APIs, the private CRM, backups and diagnostic logs must
all remain on enterprise-controlled infrastructure. AI/email/channel providers
still require the enterprise's own approved processing configuration.
