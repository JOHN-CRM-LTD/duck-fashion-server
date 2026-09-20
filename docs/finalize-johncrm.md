# Finalize Duck Fashion on the Pi

## Target and current boundary

- Pi: authoritative shop names, addresses, hours, manager details, customers and
  bonus ledger. John CRM displays these through read-only API endpoints, without
  importing a local business directory. The location UI keeps its existing design.
- DigitalOcean: Duck's customer chats, with the last **20 sent/received messages
  combined per chat**, already selected in Global Admin. Active processing may
  temporarily exceed the limit. Do not change chat hosting, webhook ownership or
  the retention policy. A points answer is naturally part of the retained chat.
- Global Admin selects business sources independently of chat hosting. API
  workspaces hide User Types and Spaces and block local business edits. Local/B2C
  workspaces keep those features. Do not disable them globally.
- This service is not a private CRM. Existing shared business rows, reservations,
  inventory snapshots and historical logs/backups have separate migration and
  cleanup lifecycles. Do not claim those were erased by selecting API mode. Keep
  reservation residency guards; do not reopen shared business writes to make a
  demo pass. Audit remaining records separately with a John CRM administrator.

## 1. Reconcile and deploy through the existing updater

Repository: `JOHN-CRM-LTD/duck-fashion-server`, branch `main`. Find the actual
checkout from `systemctl cat duck-fashion.service`; the documented example is
`/home/plushii4854/Documents/duck-fashion-server`. Keep the installed one-minute
`duck-fashion-update.timer`; do not install another timer, cron job or service.

Before upgrading, temporarily pause the updater if needed and save a consistent
SQLite backup using SQLite's backup API, plus private config/manager files, in a
restricted directory outside Git. Include a secure copy of local source changes.
Do not copy only a running SQLite main file while ignoring its WAL. Never print
credentials or customer records. Do not run `npm run seed` on live data.

Inspect local changes before reconciling with `origin/main`: the previously
observed dirty checkout prevents automatic deployment. Preserve legitimate fixes
and private files; avoid `reset --hard`, `clean`, or blindly discarding/stashing
work. Main now includes points on customer browse, persistent demo archives,
staff-only source locations, and the `/stock-api` public image URL fix. Reconcile
duplicate local edits against those changes and leave a clean tracked checkout.
Commit and push any remaining non-secret source fix before relying on the timer.

Use the existing update service to deploy, inspect its journal, then confirm the
running service is healthy, the checkout equals remote main, and the timer is
enabled/active at one minute. Keep the stable HTTPS proxy and existing Node 22
runtime. A successful Git push or fetch alone is not deployment proof.

## 2. Source locations and manager details

In the deployed checkout:

```sh
node deploy/create-staff-read-key.mjs
```

This adds a separate `staffReadApiKey` to `.local-duck/live-connection.json` if
missing. It preserves the other keys and prints no secret. Keep it in the private
config and enter it only into CRM's encrypted credential field. Never use
`writeApiKey` in John CRM.

Inspect the existing Pi `shops`, `shop_locations` and the configured private
manager directory. Prefer existing authoritative records. Each shop needs one
validated location with its stable positive numeric `id`, matching stable
`inventoryLocationId`, name, address fields, manager name/phone, country, timezone,
hours and active status. The contract is `server/location-contract.ts`.

Import missing records in one private JSON array with
`node --import tsx server/import-locations.ts /private/path/locations.json`.
Corresponding inventory `shops` IDs must already exist. For only the existing
three fictional shops, `--demo` fills explicitly labelled demo addresses using the
Pi manager directory. Do not replace known addresses with placeholders or invent
real addresses. Report missing authoritative details.

The importer is insert-only/idempotent: different existing records raise
`LOCATION_ALREADY_EXISTS`. Review existing IDs and values instead of deleting
them to make the import pass. Manager fields in `shop_locations` are stored source
fields, not a live join to managers.json: reconcile both on the Pi when assignments
change. Future updates belong in the enterprise's source administration, not CRM.

Restart `duck-fashion.service` after credential setup. Verify authenticated GET
`https://duckserver.johncrm.com/stock-api/shops?mode=locations&offset=0&limit=50`.
Read all pages until `hasMore=false`, with one unchanged `revision`, no duplicate
IDs and a count matching source shops. Missing imports must fail closed. Test
`/managers` with the staff read key; normal read keys must not expose private
location/manager details. Staff read keys must fail on stock/customer writes.

## 3. Connect John CRM (authorized Global Admin session)

Select **Duck Fashion**, workspace 71 / `ORG-9GJETX8R`; verify identity before
saving. Reuse existing endpoints and bindings where possible, preserving their
IDs and access restrictions. The stable API base is
`https://duckserver.johncrm.com/stock-api`.

**Locations:** create/select an enabled non-mutating GET endpoint in a restricted
staff-only Knowledge Base folder with no customer audience tags:

- URL: `/shops?mode=locations`; Bearer `staffReadApiKey`.
- Numeric query inputs: `offset`, `limit`; approved output fields:
  `locations`, `hasMore`, `revision`.
- In Global Admin location-source settings select that endpoint; paging parameter
  names are `offset`/`limit`, response mappings are `locations`/`hasMore`/`revision`
  for a plain connector. Use `result.locations` etc only when an integration
  adapter actually wraps its output under `result`.
- Test and activate it, then verify Workspace > Locations lists the source names,
  addresses, managers, hours and status without local edit/create controls.

**Customers/points:** keep Global Admin Customer source set to **API Endpoints**.
Keep both operations restricted to staff; the verified customer-source service
performs the identity lookup. Use the existing read `apiKey`:

- Exact lookup: GET `/customers/lookup?phone=...`, full international number;
  map customer array, stable `id`, `phone`, `name`; preserve the API's `complete`
  indicator in the response whitelist. Do not add a nonexistent UI mapping field.
- Staff browsing: GET `/customers/lookup?mode=browse`, inputs `query`, `offset`,
  `limit`; maps `customers`, `hasMore`, plus columns `id`, `name`, `nameZh`, `phone`,
  `grade`, `membershipPoints`, `joinedOn`. Existing integration adapters use
  `result.customers` / `result.hasMore`; inspect the actual response before saving.
- Keep the existing member bonus automation enabled under shop automations, with
  its three read-only endpoints: `/bonus/balance`, `/bonus/redeemables`,
  `/bonus/cash-scheme`. Balance and personalized rewards must declare both `member`
  and `phone`. Preserve their customer-readable access for this scoped capability;
  do not make the customer directory or manager directory public.
- Ensure the workspace's shop capability is enabled. API mode alone does not
  enable loyalty. Existing IDs were customer integration 8 and loyalty connectors
  15/16/17; verify current ownership/configuration instead of assuming these IDs.

If no authorized CRM login is available on the Pi, finish the Pi work and report
the exact remaining endpoint/Global Admin steps. Do not invent credentials or
claim the UI connection was saved.

## 4. Verify identity, points and service continuity

Run the repository's offline test command from `.github/workflows/ci.yml`; it
covers 300-location pagination, credentials, current points/expiry and archives.
Run production reads only using authorized test identities; keep returned personal
data out of public logs. Do not change live points just to test refresh.

For a member with a known registered full phone, exact lookup and the bonus
balance must return the same ID. CRM's Membership Points must equal the Pi's
current available ledger balance, including redemptions and expiry. A no-match,
wrong phone, phone suffix, archived account or unavailable API must not reveal a
balance or become a guessed zero. Public bonus routes independently verify both
member ID and phone even though CRM has already checked the WhatsApp sender.

WhatsApp personalization uses the actual one-to-one sender number, never a phone
or member ID typed into a prompt. Group chat and unverified web-chat numbers must
not reveal personal points. A matched sender should be able to ask “How many
bonus points do I have?” without typing a member ID. Confirm this with a manual
message from an authorized test phone when the user is ready; do not send messages
to customers or run a paid AI evaluation without explicit authorization.

Report separately: deployed Git SHA, service/HTTPS health, timer status, location
count/completeness, customer/points matching, saved CRM mappings, and any remaining
legacy-data cleanup or missing real details. A local/mock test is not proof of
real WhatsApp delivery or completed historical-data migration.
