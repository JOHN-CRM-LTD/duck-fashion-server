# Existing customer chat

`GET /customers/lookup?phone=%2B85261234567` uses the existing read credential
and returns `{ "customers": [{ "id": "DF1005", "name": "Example", "phone": "+85261234567" }], "complete": true }`.
No match returns an empty array. The caller must reject more than one match.
Only exact international numbers are accepted for identity; no names or phone suffixes.

The source is **bonus_members**, shared with the bonus-points system. `id` is
its `member_code` and `phone` is its `mobile`. There is no second customer table
and no registration during chat. Startup creates the same member schema if
needed and enforces uniqueness of formatted variants of a mobile number.
Existing member details, stock and bonus ledger entries are preserved.

For an explicit staff import, POST `{ "customers": [...] }` to
`/customers/import` using the existing **write** credential. Each record has
`id`, `name`, `phone`, and optional `nameZh`, `grade`, `joinedOn`. Existing IDs
update name/mobile only, preserving loyalty metadata. Imports are atomic,
idempotent, reject duplicate phones, and never create a second member for one phone.
Keep real customer records and credentials in private runtime files, never Git.

In JOHN CRM, add the GET endpoint in a staff-only Knowledge Base folder and
enable Configurations → Integrations → Company channels → Existing customer matching.
Map phone parameter `phone`, array `customers`, ID `id`, phone `phone`, name `name`.
The company API remains authoritative. CRM stores a minimal routing reference
and rechecks the source for each inbound message; it does not write back or onboard.

The Pi pulls `main` every five minutes. Deployment health checks cover stock
and customer lookup. CI uses synthetic members only and never contacts an AI provider.
