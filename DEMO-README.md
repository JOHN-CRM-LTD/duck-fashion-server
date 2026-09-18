# Duck Fashion demo

This folder contains the small, independent catalog used by the live Duck Fashion
workspace in John CRM (workspace 71). Open `catalog.html` for the visual catalog.

- `duck-fashion.sqlite`: the working SQLite database.
- `catalog.json`: a readable export of product definitions and initial stock; editing this file alone does not update the database.
- `schema.sql`: database table definitions.
- `availability-matrix.json`: 72 variant rows with source stock at each shop; CRM adds live reservation adjustments.
- `images/`: 24 labelled product pictures covering burgundy, cream and black (and earlier reference pictures). No generated pictures are used.
- `Start-Demo.ps1`: restart the stock service, tunnel and local chat helper.

## Collection

Every item has **S, M and L** in **Duck Burgundy, Chalk Cream and Ink Black**:
8 items × 3 sizes × 3 colours = **72 separately reservable SKUs**.

| Code | Item | Demo price (HKD) | Photo |
| --- | --- | ---: | --- |
| DF01 | Signature Duck Sweatshirt | 329 | Burgundy, cream and black |
| DF02 | Duck Outline Graphic T-Shirt | 189 | Burgundy, cream and black |
| DF03 | Duck Utility Cargo Trousers | 399 | Burgundy, cream and black |
| DF04 | Signature Duck Baseball Cap | 149 | Burgundy, cream and black |
| DF05 | Everyday Duck Hoodie | 429 | Burgundy, cream and black |
| DF06 | Duck Label Rib-Knit Beanie | 129 | Burgundy, cream and black |
| DF07 | Weekend Duck Twill Overshirt | 459 | Burgundy, cream and black |
| DF08 | Weekend Duck Jersey Shorts | 249 | Burgundy, cream and black |

Garment measurements, trouser/short waist ranges and hat circumference ranges
are in the catalog. Prices, materials, measurements and stock are invented demo
values. All eight items have owner-supplied photos in all three colours.

## How it is connected

The existing **Everyone → Duck Fashion inventory → Duck Fashion local stock**
integration serves product details and inventory to external chat. The existing
native **Item reservation · WhatsApp manager approval** automation continues to use
that stock endpoint. Shop mappings stay PCL, PCB and SH015; CRM remains the authority
for actual shop names, addresses, hours, assigned managers and customer contact details.

This database has 216 stock rows (72 variants at 3 shops). Most start with 3–8 units.
`DF01-BUR-M` is a last-item scenario: 1 at Jumbo Sogo / SH015 and 0 at the other shops.

Reservations are stored in John CRM. Pending requests do not hold stock; manager
acceptance does. NOT SOLD releases the hold; SOLD records a completed sale. In snapshot
mode CRM deducts confirmed holds and completed sales from this database's quantities.
Do not separately subtract the same CRM sale from SQLite, or it will be counted twice.

Both the old SE_TEST source and the larger DuckFashion_Demo SQL catalog are disconnected
from the live bridge. They are preserved for rollback. Existing CRM reservation history
is preserved; the new collection has distinct SKUs. Database rollback configuration is
kept privately at `D:\johncrm\.local-duck\before-capsule-20260917.json`.

## Start after a restart

Run in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\wyau7\Desktop\duck_demo\Start-Demo.ps1
```

Keep the laptop and Cloudflare tunnel running for cloud CRM access. Docker is not needed
for this catalog. This is still a temporary quick tunnel: if it changes after restart,
update the integration Base URL and the `url` property in the private local connection
config, restart the bridge, run its ordinary adapter checks, and activate the saved version.
The credential stays private in `D:\johncrm\.local-duck\live-connection.json`.
Only named product photographs are publicly served; database and exports are not exposed.

## Chat behavior

The active Knowledge Base integration is version 7. John lists the eight items when
asked what Duck Fashion sells. When an item is selected, John checks stock, sends
its supplied photo(s), lists available colours/sizes and asks for a choice. Actual
image attachments are scoped to the chat recipient.

Ask for a whole-collection matrix to see all 72 combinations, normally grouped into
24 item/colour rows with the available sizes. The native inventory tool deducts
confirmed holds and completed sales, across the active mapped shops.

## Example customer requests

- "Show me your clothing collection."
- "Do you have the black hoodie in medium?"
- "Can I reserve the burgundy Signature Duck Sweatshirt in M at Jumbo Sogo?"

For reservations, select a future date/time within the shop's configured hours and
confirm the details. A customer conversation uses the normal CRM AI and can send a
manager alert. Three paid AI checks were approved on 17 September 2026. The eight-item
list passed; the first hoodie check exposed a CRM inventory parsing bug, now fixed
and covered by regression tests. Final live results are recorded in VERIFICATION.md.
No real reservation or WhatsApp manager alert was sent during setup.

## Photo handling

Black photos were added on 17 September 2026 by placing black_beanie.png,
black_cap.png, black_graphic_t_shirt.png, black_hoodie.png, black_overshirt.png,
black_shorts.png, black_sweatshirt.png and black_trousers.png in
C:\Users\wyau7\Downloads\black and rerunning scripts/duck-fashion/seed-capsule.ts
from D:\johncrm. The same steps rerun safely after replacing any photo; existing
stock and reservation history are preserved.

availability-matrix.json is a source-stock snapshot. Customer-facing matrices use
live CRM inventory results after confirmed holds and completed sales are deducted.

The source code is in D:\johncrm\scripts\duck-fashion\capsule-*.ts.

## Member bonus points

The same SQLite database carries a small loyalty section (tables
`bonus_members`, `bonus_periods`, `bonus_ledger`, `bonus_redeemables`,
`bonus_cash_tiers`) seeded by `npm run seed:bonus` — and also re-seeded
idempotently on every service boot, so a code-only deploy on the Pi brings
the endpoints up with no manual step. Three read-only endpoints sit behind
the normal bearer read key:

| Endpoint | Answers | Notes |
| --- | --- | --- |
| `GET /bonus/balance?member=…` | "How much bonus points do I have?" | Member by code, full or local-form mobile (`61234505` matches `+852 6123 4505` via last-8 digits), or exact name. Returns tier, available points, per-period breakdown and an `expiringSoon` warning. |
| `GET /bonus/redeemables?member=…` | "What items can I redeem with bonus?" | All items with code, unit price and points needed; with a member, affordability flags. |
| `GET /bonus/cash-scheme` | "What's the scheme of Bonus-as-Cash?" | Base ratio 100 PTS = $1.00 and tiers 500 PTS = $5 / 1000 PTS = $12. |

Balances always derive from `bonus_ledger`, so the demo never disagrees with
itself. Real customer records never enter Git: each machine's member roster
lives in its own `data/duck-fashion.sqlite` (imported through the staff
write endpoint, see CUSTOMER-MATCHING.md), while the seed carries only a
synthetic roster (fictional +852 6123 45xx numbers) so fresh clones and CI
have working members. The demo ledger is written for the member codes that
exist on that machine — on the live Pi that means the real imported members
and the two chat-demo customers (DF-DEMO-AU, 260 PTS — not yet enough for
the cheapest redeemable; DF-DEMO-HK, 150 PTS in the expiring-soon 2026A
period). The fictional +852 9123 000X series (DF1001–DF1004) stays retired
and does not resolve. Redemptions and conversions are completed in shop —
these endpoints are read-only.
