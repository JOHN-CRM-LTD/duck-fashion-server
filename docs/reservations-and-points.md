# Reservations and member points

The demo manager directory covers PCB, PCL and SH015 at `+85296540199`.
`GET /managers` requires the staff write credential. A private
`.local-duck/managers.json` replaces the defaults; an invalid file fails closed.
Never place the staff credential or the private manager directory in a
customer-readable Knowledge Base folder.

John CRM owns reservation state and saved shop locations. Inventory shop IDs
must match the location's inventory mapping. Configure each location's address,
hours, timezone and manager phone in the workspace database. Chat must read
those current shop records, not addresses copied into prose or inferred from
the shop name. Demo pickup records must be labelled as demo locations.

Reservation flow: check stock, collect name/contact and pickup details, ask the
customer to confirm, send the manager a WhatsApp Business notification, then
acknowledge submission. A manager replies to the alert or includes its
`R-XXXXXXXX` reference: `1` / `YES` / `ACCEPT` to reserve; `2` / `NO` / `DECLINE`
to decline. Customer confirmation follows only after approval and a fresh stock
check. `SOLD` completes a collection; `NOT SOLD` releases the hold. Neither
customer nor manager needs a new John CRM Users record.

Points endpoints now require matching identity for personal data:

- `GET /bonus/balance?member=DF1005&phone=85261234505`
- `GET /bonus/redeemables?member=DF1005&phone=85261234505`
- `GET /bonus/redeemables` and `/bonus/cash-scheme` remain generic catalog reads.

Use the actual WhatsApp sender phone or ask a website-chat visitor for their
registered international phone. Names and phone suffixes cannot verify a
member. Missing, invalid and mismatched pairs all return 403 without revealing
candidate members. Existing members and points stay in the Pi SQLite database;
lookups do not register anyone. Demo fixtures are fictional.

Offline verification: `node --import tsx --test server/*.test.ts`, then the CI
seed/config/smoke sequence against a disposable local database. The smoke
script changes demo stock and must not target a live data directory.
