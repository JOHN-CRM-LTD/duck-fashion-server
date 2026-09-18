# Duck Fashion stock API

Fictional eight-style Duck Fashion demo collection served as a stock API for
John CRM: product search, per-shop inventory, staff stock adjustments and
member bonus points (balance, redeemables, Bonus-as-Cash) over HTTPS, backed
by a single portable SQLite file. Node.js 22 only — no SQL
Server, no Docker, nothing compiled; runs happily on a Raspberry Pi.

```
John CRM (cloud)  ⇄  Cloudflare edge  ⇄  cloudflared tunnel (on Pi)  ⇄  127.0.0.1:4997 stock service  ⇄  data/duck-fashion.sqlite
```

- [CI-CD.md](CI-CD.md) — how GitHub Actions tests every push and how the Pi
  auto-deploys every 5 minutes (with rollback)
- [PI-SETUP.md](PI-SETUP.md) — full Pi walkthrough: Node 22, systemd,
  Cloudflare tunnel, wiring the CRM
- [SERVER-SETUP.md](SERVER-SETUP.md) — API contract, auth model, endpoints
- [DEMO-README.md](DEMO-README.md) — the demo collection itself

## Quick start

```bash
npm install          # pure-JS dependencies (ARM-friendly)
npm run seed         # rebuild data/duck-fashion.sqlite from data/catalog.json
npm start            # listens on 127.0.0.1:4997 (needs deploy/create-config.sh first)
npm run seed:bonus   # optional — the member-bonus tables are also (re)seeded
                     # idempotently on every boot; this just runs the same seed
```

`data/duck-fashion.sqlite` and `.local-duck/live-connection.json` are
gitignored on purpose: the first is live stock, the second holds the
read/write keys. Neither ever leaves the machine they live on.
