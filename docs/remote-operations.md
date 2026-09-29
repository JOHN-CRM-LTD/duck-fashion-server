# Remote demo operations

This is the current operations guide. The older Pi guide describes the original
combined service. The code supports that layout during migration; installing the
new layout is a separate, one-time Pi operation. A Git push is not proof of that
installation or of working remote access.

## Problems addressed

- `/managers` and CRM locations previously read different copies of manager
  assignments. Imported SQLite locations now supply both. Private managers.json
  is only an import source/fallback before any locations exist.
- There was no update operation for existing locations. A dedicated admin API
  now edits manager/name/phone/address/hours/status/reservation settings, validates
  complete records, rejects stale revisions, and records before/after history.
- Glacier previously shared Duck's process, credentials file and data directory.
  A missing Glacier database could prevent Duck from starting. They can now run
  independently, with separate systemd sandboxes, credentials and runtime data.
- The updater previously deployed before CI completed and could fail to reinstall
  old dependencies on rollback. It now checks successful CI for the exact SHA,
  makes a consistent Duck backup and restores dependencies on rollback.
  Code deployments never change private Glacier data.
- Changing the public URL used to rotate keys; enabling Glacier could discard
  staff credentials and custom settings. Both now preserve existing settings.

## Runtime layout after installation

```text
/srv/duck-fashion/
  config/connection.json        Duck credentials and runtime configuration
  data/duck-fashion.sqlite     Shops, managers, stock, customers, points, edit history
  data/images/                 Duck product images
  backups/                     Consistent pre-deploy databases and pre-split config
/srv/glacier/
  config/connection.json        Glacier credential and database path
  data/glacier-icerink.sqlite   Read-only booking snapshot
  backups/
```

The existing Git checkout remains the shared **code** checkout. There are no
business databases in Git. Duck runs on 127.0.0.1:4997; Glacier runs on
127.0.0.1:4998. Each service's sandbox hides the other application's `/srv` folder.
They retain the current service account; the updater can administer both.
Source changes restart the affected service; common dependency/deployment changes
restart both when Glacier is configured. Glacier still offers read-only snapshot
data, not booking writes. If Glacier has moved to the CRM deployment and its Pi
key is absent, the installer leaves the local Glacier service disabled; it never
changes CRM source settings or retrieves customer data from Git.

## One-time Pi installation

1. Ensure SSH works from outside home, preferably through an existing private
   VPN/Tailscale connection. This repository cannot provision that account or
   recover a powered-off/offline Pi. Keep the existing stable HTTPS hostname.
2. In the installed checkout, inspect `git status`, `systemctl cat duck-fashion`,
   and the updater journal. Preserve and reconcile local changes. Merge the
   tested release and allow the existing updater to deploy it.
3. Check the imported location directory and manager file agree. The installer
   refuses an incomplete directory or mismatching assignments. Import missing
   authoritative records with `server/import-locations.ts`; never reseed live
   stock or delete locations to resolve a conflict.
4. Run `sudo bash deploy/install-layout.sh` from that checkout. If the old config
   is elsewhere, pass its full path. This briefly pauses the existing timer and
   service, copies a consistent database, preserves keys and original files,
   installs service drop-ins plus the optional existing Glacier, and verifies the
   configured services. On failure
   it restores the old service setup and retains prepared files for inspection.
   It never overwrites an existing `/srv/duck-fashion` or `/srv/glacier` tree.
5. Run `bash deploy/doctor.sh`. Verify both services and the existing timer are
   enabled/active as applicable, and inspect the configured public endpoints. The original
   `/stock-api/glacier` URL continues through a compatibility proxy. For complete
   request-path independence, replace its nginx location using
   `deploy/nginx-demo-services.conf.example`, then `sudo nginx -t` and
   `sudo systemctl reload nginx`. Keep the current TLS configuration.

The installer preserves the original source files as rollback copies. After
verified cutover, archive those old private files outside the checkout in a
restricted backup directory. Do not delete them before confirming the running
services use `/srv` and backups can be opened. Review backup retention/disk space
periodically; the updater never automatically deletes business backups.

## Edit remotely without Git or restarting the service

The admin key is separate from ordinary read, staff read, stock write and Glacier
keys. None of those other keys can use `/admin`. Do not put the admin key in CRM.
The repository is public: real phone numbers belong in private operator edits,
not committed config files.

You can use SSH directly, without exposing an admin HTTPS route:

```sh
# Inside the Pi checkout, over your existing SSH connection:
export DUCK_CONFIG=/srv/duck-fashion/config/connection.json
npm run admin -- locations
npm run admin -- set-manager PCB +85212345678 "Demo manager"
npm run admin -- history PCB
npm run admin -- undo PCB <requestId>
```

The number above is a placeholder; use the intended demo recipient. Undo only
works if that edit is still current, preventing it from erasing a later change.
Edits immediately affect subsequent Pi API reads. An already-open CRM page may
need refreshing; an already-sent WhatsApp alert is not redirected retroactively.

For use directly from your laptop, add the optional nginx `/stock-api/admin/`
location in the example, validate/reload nginx, and export a private connection:

```sh
# On the Pi, with DUCK_CONFIG set as above:
node deploy/export-admin-connection.mjs /private/path/admin-connection.json
```

Transfer it securely with SCP to `.local-duck/admin-connection.json` in your
laptop checkout. Alternatively set `DUCK_ADMIN_CONNECTION` to its private path.
Then the same `npm run admin` commands work over HTTPS from outside home. No
token is placed in the shell arguments, browser storage, URL or Git. To use an
SSH port forward instead, export with URL `http://127.0.0.1:4997` and forward
that port to the Pi's loopback port 4997.

To edit other fields, create a private JSON file such as:

```json
{ "addressLine1": "Approved demo pickup address", "isActive": true,
  "hours": { "mon": [{ "open": "10:00", "close": "20:00" }] } }
```

Run `npm run admin -- update PCB /private/path/changes.json`. Unspecified fields
are preserved; `hours` replaces the entire weekly schedule. Stable location/shop
IDs cannot be edited. The client saves the exact pending request privately, so
after a timeout `npm run admin -- retry .local-duck/remote-pending.json` is safe.

## Reviewed demo changes through main

1. Read the current location and prepare the desired fields in a private JSON file.
2. `npm run --silent admin -- plan PCB /private/path/changes.json` prints a change
   with a unique request ID and the current expected revision.
3. Append that entry to `config/duck-fashion/location-changes.json`, review it,
   and merge to `main` after PR checks pass. Commit only approved demo data.
4. The timer waits for successful main CI, backs up Duck, deploys and restarts it.
   Each change applies transactionally **once**. A later private edit survives
   subsequent restarts. A stale/conflicting batch is rejected as a whole and
   startup fails, prompting deployment rollback instead of overwriting newer data.
5. Verify `npm run admin -- location PCB` and the updater journal.

Keep applied entries immutable. Reverting a Git commit does not undo a business
edit; use `undo` or submit a new explicit change. Code rollback preserves Duck
business data and audit history. Restoring an entire database could discard newer
stock/points activity, so database restore is a separate operator decision.

CI validates the change schema and transaction behavior. Its disposable config
sets `applyGitLocationChanges: false` because live revision hashes do not describe
the fresh CI fixture database. Leave this flag absent (or true) in production;
actual source revision checks happen on the Pi at startup.

## Troubleshoot from anywhere

```sh
bash deploy/doctor.sh
journalctl -u duck-fashion-update.service -n 40 --no-pager
journalctl -u duck-fashion.service -u glacier.service -n 40 --no-pager
sudo systemctl start duck-fashion-update.service
# Force same-commit restart/health checks, with the /srv config environment set:
bash deploy/pull-update.sh --repair
sudo systemctl restart glacier.service
```

If exact-commit CI cannot be verified (including GitHub rate limiting), the updater
retains the current release. For frequent deployments an operator may provide a
restricted `GITHUB_TOKEN` through a private systemd EnvironmentFile; never Git.
Do not bypass CI for an unattended deployment. The first upgrade from the legacy
updater still needs a green PR before merging, since the old script lacks this gate.

For an intentional refresh of an existing Pi Glacier adapter, securely transfer
an export outside the checkout, then run
`node --import tsx deploy/refresh-glacier.ts /private/path/export.tsv.gz` with the
runtime config environment set. It backs up the old private database and replaces
it atomically; restart `glacier.service` (or `duck-fashion.service` for the legacy
combined layout). Never commit customer exports, even scrubbed subsets. Check
`dataAsOf` in authenticated responses before presenting it as current data.
