# Hosting Duck Fashion on a Raspberry Pi

This guide takes you from the USB stick to a Pi that serves the Duck Fashion
stock API to John CRM 24/7. Works on any Raspberry Pi with Raspberry Pi OS
(Bookworm, 32- or 64-bit). The service needs no SQL Server, no Docker and
nothing compiled — Node.js has SQLite built in, and every dependency is pure
JavaScript, so ARM is not a problem.

```
John CRM (cloud)  ⇄  Cloudflare edge  ⇄  cloudflared tunnel (on Pi)  ⇄  127.0.0.1:4997 stock service  ⇄  data/duck-fashion.sqlite
```

If you ever get stuck: `systemctl status duck-fashion` and
`journalctl -u duck-fashion -b` show what the service is doing.

## 0. Copy the bundle off the USB stick

Plug the USB stick into the Pi (it mounts under `/media/<your-name>/...`),
then:

```bash
sudo apt update
sudo apt install -y curl unzip
cp /media/pi/USB/duck-fashion-server.zip ~        # adjust the path
cd ~ && unzip duck-fashion-server.zip && cd duck-fashion-server
```

Important: use the **zip**, not a copy of the Windows folder with
`node_modules` inside — dependencies must be installed on the Pi (step 2)
because one of them ships a platform-specific binary.

Also check your architecture (both work, good to know which you have):

```bash
uname -m    # aarch64 = 64-bit, armv7l = 32-bit
```

## 1. Install Node.js 22

The `nodejs` package in Raspberry Pi OS is too old (it lacks the built-in
SQLite this service uses). Install Node 22 from NodeSource instead:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # must print v22.13 or newer
```

## 2. Install the service's dependencies

From inside the bundle folder (`~/duck-fashion-server`):

```bash
npm install
```

## 3. Install cloudflared and start the tunnel

This is the same Cloudflare tunnel the laptop uses — the CRM in the cloud
needs a public HTTPS address to reach your Pi, and the tunnel provides one
without opening anything on your router.

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

Start it as a service (this is the quick-tunnel flavour: no Cloudflare
account needed):

```bash
sudo cp deploy/duck-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now duck-tunnel
sleep 5
journalctl -u duck-tunnel -b --no-pager | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

That last command prints your public URL, e.g.
`https://hobby-governor-cartoons-kentucky.trycloudflare.com`. Write it down.

## 4. Create the service config

Still in `~/duck-fashion-server`, with your tunnel URL from step 3:

```bash
bash deploy/create-config.sh https://<your-tunnel-url>
```

This generates fresh read/write keys, writes `.local-duck/live-connection.json`
and prints both keys once. The **read key** goes into John CRM later; the
**write key** stays private (it is only for staff stock adjustments).

## 5. Start the stock service

```bash
sudo cp deploy/duck-fashion.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now duck-fashion
```

If your Pi username is not `pi`, or the folder is not
`/home/pi/duck-fashion-server`, edit the `User=` and `WorkingDirectory=`
lines in `/etc/systemd/system/duck-fashion.service` first.

Verify locally, then through the tunnel (use your read key):

```bash
curl -s -H "Authorization: Bearer <read-key>" http://127.0.0.1:4997/shops
curl -s -H "Authorization: Bearer <read-key>" "https://<your-tunnel-url>/shops"
curl -s -o /dev/null -w "%{http_code}\n" "https://<your-tunnel-url>/images/black_hoodie.png"   # expect 200
```

Both curls should return the three shops (`PCB`, `PCL`, `SH015`); the image
check should print `200`. The service only ever listens on `127.0.0.1`, so
nothing on your network can reach it directly — only through Cloudflare.

## 6. Point John CRM at the Pi

In John CRM: Knowledge Base → Duck Fashion inventory → Duck Fashion local
stock. Update the Base URL to `https://<your-tunnel-url>` and the credential
to the new read key, save, run the adapter checks, then activate. From that
moment the Pi is the live stock source; keep the laptop's `duck_demo` folder
as the rollback copy. (If you do this later than the day the zip was made,
first re-copy `data/duck-fashion.sqlite` from the laptop so any stock
adjustments made in between come along.)

## 6b. Turn on the Glacier IceRink read API (optional)

The same service can also serve the Glacier booking snapshot to the CRM's
glacier workspace automations — one command, see [GLACIER.md](GLACIER.md):

```bash
bash deploy/enable-glacier.sh     # seeds the snapshot DB + prints the glacier key
sudo systemctl restart duck-fashion
curl -s http://127.0.0.1:4997/glacier/health
```

Then wire the CRM with `johncrm/glacier-api/docs/johncrm-manifest-duckserver.json`
(baseUrl `https://duckserver.johncrm.com`, origin only) and the printed key
(see GLACIER.md). Until enabled,
the glacier code sits inert: no routes, no key, no change to the stock API.

## Things to know

- **The quick-tunnel URL changes whenever the tunnel restarts** (reboots,
  `systemctl restart duck-tunnel`). After a change: read the new URL with the
  `journalctl` command from step 3, rerun `create-config.sh` with it,
  `sudo systemctl restart duck-fashion`, and update the Base URL in CRM.
  If you have your own domain, you can instead create a *named* Cloudflare
  tunnel (free account) with a permanent URL — ask and we'll set that up.
- The Pi must stay powered and online for customer chats to check stock.
  A Pi Zero is enough; the service idles at roughly 50 MB RAM.
- **Backups**: `sudo systemctl stop duck-fashion`, copy
  `data/duck-fashion.sqlite` (e.g. back to the USB stick), start it again.
- Rotating keys = rerun `create-config.sh` + restart the service + update the
  CRM credential. Never commit or share `.local-duck/live-connection.json`.
