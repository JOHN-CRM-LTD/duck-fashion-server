# Glacier IceRink read API (legacy Pi adapter)

An existing private Pi adapter can be isolated into `/srv/glacier` and its own
service on port 4998; see [Remote demo operations](docs/remote-operations.md).
That optional local separation does not change the CRM workspace's selected
source or move its dataset back from the CRM deployment.

This repository contains the read-only SQLite adapter code, but **no Glacier
customer data**. The Glacier workspace is moving to a separate private dataset
hosted by the CRM deployment. Duck Fashion stock and loyalty remain on the Pi.

Existing installations with a private `data/glacier-icerink.sqlite` and a
`glacierApiKey` continue serving `/glacier`. A normal code update does not replace,
reseed, or delete that database or its credential. Keep them until the Glacier
workspace has switched to the new service and its reads have been verified.

## Public repository policy

- Never commit customer exports, database backups, credentials, or scrubbed
  customer subsets. Replacing phone numbers alone does not make records public.
- Keep source exports and restore/import output outside the checkout, in private
  storage with restricted access. Keep only synthetic fixtures in source tests.
- `npm run check:public-data` checks tracked paths, including forcibly added
  files; CI runs it before seeding or booting the fictional Duck demo.
- `.gitignore` prevents common customer export and database files from being
  added accidentally. It does not remove files from existing Git history.

## Fresh installations

`deploy/create-config.sh` creates Duck read/write keys only. Glacier stays off
unless an operator deliberately configures it with an existing private database.
The script preserves existing Duck, Glacier and staff-read keys when changing
the public URL. CI tests the Glacier routes with synthetic temporary data only.

For a legacy private SQLite deployment, provide a private export explicitly:

```bash
npm run seed:glacier -- /private/path/glacier.tsv.gz
bash deploy/enable-glacier.sh
sudo systemctl restart duck-fashion
```

Alternatively, `bash deploy/enable-glacier.sh /private/path/glacier.tsv.gz`
seeds a missing private database before enabling it. Neither command downloads
customer data from Git. `seed:glacier` replaces the existing Glacier SQLite
snapshot, so run it only for an intentional refresh and keep a private backup.

## Existing integration contract

The legacy adapter provides authenticated GET routes for students, packages,
lessons, tuition payments, customer context and student automation context.
Booking creation, cancellation and settlement are unsupported. Responses carry
`source.dataAsOf`, `source.timeZone` and `source.mode`; the dataset is a fixed
snapshot, not a live feed. Do not relabel its historical records as current data.

The Pi proxy may still expose `/stock-api/glacier/*`, forwarding to
`127.0.0.1:4997/glacier/*`. Existing manifests use an origin-only base URL and
include that prefix in operation paths. Leave this route and its configured key
in place until the CRM workspace has switched successfully.

After cutover, remove only the Glacier key and proxy route, restart and verify
Duck stock/customer/bonus health, then retire the private Glacier snapshot.
Do not delete or reseed `data/duck-fashion.sqlite`, and do not replace Duck keys.

## History cleanup and Pi updates

Deleting an export in a normal commit removes it from the current tree only.
The separate history cleanup must cover every affected branch and GitHub PR ref.
Its force-update requires a coordinated maintenance window and reviewed approval.

The Pi updater uses fast-forward-only Git pulls. Before publishing rewritten
history, stop its update timer and prepare a private backup of live files and
local work. After the approved rewrite, realign the checkout to the reviewed
clean commit while preserving ignored databases and keys, then restart the timer.
Never merge or push an old checkout into the cleaned history. Do not run
`git clean` or `npm run seed` against the live Duck installation.
