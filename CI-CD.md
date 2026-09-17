# CI/CD: GitHub → Raspberry Pi

The repository lives on the **JOHN CRM** GitHub organization. Code changes
travel in two steps:

1. **CI (GitHub Actions)** — every push to `main` (and every pull request)
   runs `.github/workflows/ci.yml`: install dependencies, seed a fresh
   SQLite database from `data/catalog.json`, boot the API and run the
   endpoint checks in `deploy/smoke-test.sh`. A commit that breaks boot,
   auth, search, photos or stock adjustments never passes CI.
2. **CD (the Pi pulls)** — `duck-fashion-update.timer` on the Pi runs
   `deploy/pull-update.sh` every 5 minutes. If `main` has moved, the script
   fast-forwards, reinstalls dependencies when `package-lock.json` changed,
   restarts `duck-fashion.service`, health-checks `/shops` and **rolls the
   commit back automatically** if the service does not come up healthy.

```
git push to main ──> GitHub Actions smoke test ──> main is green
                                                        │
Pi timer (every 5 min) ── git fetch ── new commit? ─yes─> pull + npm ci + restart + health check
                                                        └─ unhealthy? git reset back, restart, log
```

## What a deploy never touches

- `data/duck-fashion.sqlite` — the **live** database (gitignored). Deploys
  swap code, not stock. A fresh clone rebuilds a pristine database with
  `npm run seed`.
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
exactly one command without a password: `systemctl restart duck-fashion.service`.

## Making changes safely

- Push to `main` only after CI is green (or open a pull request and let CI
  check it first — the Pi deploys whatever is on `main`).
- Changes that alter dependencies update `package-lock.json`; the Pi
  reinstalls automatically — no manual steps.
- If the working tree on the Pi is dirty, the updater refuses to deploy and
  logs the reason. Keep the Pi checkout clean: make changes via GitHub.

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
