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
  auto-deploys every minute (with rollback)
- [PI-SETUP.md](PI-SETUP.md) — full Pi walkthrough: Node 22, systemd,
  Cloudflare tunnel, wiring the CRM
- [SERVER-SETUP.md](SERVER-SETUP.md) — API contract, auth model, endpoints
- [DEMO-README.md](DEMO-README.md) — the demo collection itself
- [docs/finalize-johncrm.md](docs/finalize-johncrm.md) — finalize Duck's Pi business
  APIs, CRM location/points display and WhatsApp matching; chats remain on DigitalOcean
- [docs/private-crm.md](docs/private-crm.md) — hosting choices and the optional
  separate enterprise CRM deployment and cutover

## Quick start

```bash
npm install          # pure-JS dependencies (ARM-friendly)
npm run seed         # rebuild data/duck-fashion.sqlite from data/catalog.json
npm start            # listens on 127.0.0.1:4997 (needs deploy/create-config.sh first)
npm run seed:bonus   # optional — the member-bonus tables are also (re)seeded
                     # idempotently on every boot; this just runs the same seed
```

`data/duck-fashion.sqlite` and `.local-duck/live-connection.json` are
gitignored on purpose: the first is the live business database, the second holds
the ordinary read, staff read and write keys. Keep the database and write key on
the Pi; enter only the appropriate read credentials into CRM's encrypted endpoint
settings. Keep backups private.
