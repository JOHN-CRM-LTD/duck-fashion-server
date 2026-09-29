# CI/CD: GitHub → Raspberry Pi

The repository lives on the **JOHN CRM** GitHub organization. Code changes
travel in two steps:

1. **CI (GitHub Actions)** — every push to `main` (and every pull request)
   runs `.github/workflows/ci.yml`: install dependencies, seed a fresh
   SQLite database from `data/catalog.json`, boot the API and run the
   endpoint checks in `deploy/smoke-test.sh`. A commit that breaks boot,
   auth, search, photos or stock adjustments never passes CI.
2. **CD (the Pi pulls)** — `duck-fashion-update.timer` on the Pi runs
   `deploy/pull-update.sh` every minute. If `main` has moved, it waits for a
   successful CI run for that exact SHA, backs up Duck, fast-forwards, reinstalls
   changed dependencies, restarts affected services and checks health. Failure
   restores the old code, dependencies and Glacier snapshot. Duck business edits
   remain intact. See [Remote demo operations](docs/remote-operations.md) for the
   separate runtime layout and private manager/location administration.

```
git push to main ──> GitHub Actions smoke test ──> main is green
                                                        │
Pi timer (every 1 min) ── git fetch ── new commit? ─yes─> pull + npm ci + restart + health check
                                                        └─ unhealthy? git reset back, restart, log
```

## Persistent data and deployment changes

After the split, private runtime files live under `/srv/duck-fashion` and
`/srv/glacier`. The paths below describe the legacy layout. Explicit reviewed
entries in `config/duck-fashion/location-changes.json` update existing locations
once, with revision checks and audit history; code rollback does not undo them.

- `data/duck-fashion.sqlite` — the **live** database (gitignored). Deploys
  swap code, not stock. A fresh clone rebuilds a pristine database with
  `npm run seed`. One deliberate exception: on every boot the service runs the
  idempotent `seedBonus`. It creates missing bonus tables/periods, seeds the
  fictional roster only for an empty database, adds missing fixture ledger entries
  for existing demo member IDs and refreshes the demo rewards catalogue. Recorded
  redemptions survive. It also preserves archive markers for DF-DEMO-AU/HK and
  retains those accounts' history. The older DF1001–DF1004 fixture cleanup still
  deletes those four retired demo IDs and their history. This is a demo-specific
  initializer, not a migration for arbitrary enterprise data. Back up before a
  first upgrade; never run `npm run seed` against the live database.
- `data/glacier-icerink.sqlite` — the Glacier IceRink snapshot database
  (gitignored, **derived**): unlike the stock database it holds no live edits
  and is rebuilt from the committed `data/glacier-icerink.tsv.gz` by
  `npm run seed:glacier`. When a `glacierApiKey` is configured and the
  database is missing or the snapshot content changes, `pull-update.sh` re-seeds it before restarting the
  service, so the snapshot travels as code. See [GLACIER.md](GLACIER.md).
- The deploy health check covers `/shops`, `/customers/lookup` and
  `/bonus/cash-scheme`, staff locations/managers and admin status when configured,
  plus Glacier health on its configured service; an unhealthy release rolls back.
- `.local-duck/live-connection.json` — the read/write keys (gitignored),
  generated per machine by `deploy/create-config.sh`.

## Operating the pipeline

```bash
# force a deploy check right now
sudo systemctl start duck-fashion-update.service
journalctl -u duck-fashion-update.service -n 30 --no-pager   # what it did

# stop / resume automatic updates
sudo systemctl stop duck-fashion-update.timer
sudo systemctl start duck-fashion-update.timer

# deploy state
git -C /home/plushii4854/Documents/duck-fashion-server log --oneline -3
```

The updater restarts the service with a narrowly scoped sudoers rule
(`/etc/sudoers.d/duck-fashion-update`) that allows `plushii4854` to run
`systemctl restart duck-fashion.service` without a password. The split installer
adds a separate narrow rule for `systemctl restart glacier.service`.

## Making changes safely

- Use a pull request to check CI before merging. The upgraded updater also
  waits for successful main CI for the exact commit. The first upgrade still
  runs the legacy updater, so verify PR checks before that merge.
- Changes that alter dependencies update `package-lock.json`; the Pi
  reinstalls automatically — no manual steps.
- If the working tree on the Pi is dirty, the updater refuses to deploy and
  logs the reason. Keep the Pi checkout clean: make changes via GitHub.
- Pulling code does not import location records, provision the staff read key or
  select Knowledge Base sources. Follow [finalize-johncrm.md](docs/finalize-johncrm.md)
  once for the current Duck deployment. The upgraded timer waits for GitHub CI.

## First setup on a new Pi (summary)

```bash
git clone https://github.com/JOHN-CRM-LTD/duck-fashion-server.git
cd duck-fashion-server && npm install && npm run seed
bash deploy/create-config.sh https://<your-tunnel-url>
sudo cp deploy/duck-fashion.service /etc/systemd/system/
sudo cp deploy/duck-fashion-update.service deploy/duck-fashion-update.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now duck-fashion duck-fashion-update.timer
```

See `PI-SETUP.md` for the full walkthrough (Node 22, Cloudflare tunnel, CRM
wiring) and `SERVER-SETUP.md` for the API contract.
