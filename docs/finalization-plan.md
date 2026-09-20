# Duck / John CRM finalization

The approved Duck deployment is hybrid: shops, manager contact details, addresses,
customer identities and bonus ledgers remain on the Pi. John CRM reads those APIs.
Customer chats stay on DigitalOcean with the last 20 messages retained per chat.
The existing one-minute systemd updater remains the deployment mechanism.

## Findings and implementation

- The Pi repository's customer browse response lacks `membershipPoints`, although
  John CRM already maps that field. Reuse the same ledger calculation as balance
  lookup, including redemptions and expiry; verify updates appear on the next read.
- Reconcile the already-implemented demo account archives from the John CRM mirror
  so deploying main cannot expose retired accounts again. Preserve their stored
  member and ledger history and keep phone ownership unique.
- Preserve the Pi repository's public image URL prefix fix and staff-only location
  authorization. Test exact full-phone/member matching and reject mismatches at
  the HTTP boundary. No paid AI calls are needed for these checks.
- The live Locations source has not been connected. Its staff credential, source
  records and Knowledge Base mapping need explicit setup; pulling code alone does
  not perform it. Correct docs that currently require a private CRM for Duck chats.
- Previously observed local Pi edits block the updater. The Pi handoff must back up
  and reconcile those edits, never reset or overwrite the live database/config.
- Existing shared business rows and reservations need a separate audited migration
  and cleanup. Read-only API selection does not erase historical data. Do not claim
  full business-data removal or enable shared reservation writes from this handoff.

## Verification and delivery

1. Add failing regression tests, then port the missing source behavior.
2. Run the full Duck offline suite and existing John CRM identity/loyalty checks.
3. Document the exact Pi and Global Admin setup, including safe restart/imports,
   field mappings, permission checks, updater status and remaining migration work.
4. Commit scoped changes and push main; verify remote parity and GitHub CI.
5. Provide a copy/paste Pi-agent prompt. Report Pi deployment separately from Git
   publication; runtime verification happens on the Pi during that handoff.

## Local verification completed

- The new browse/points/archive regressions failed before the source port and
  passed afterward. All 23 Duck unit/HTTP tests passed, including image prefixes.
- John CRM's 16 customer-source/loyalty tests, 6 enterprise business-boundary tests
  and 3 location contract tests passed with mocked connectors and isolated data.
- Independent review found no introduced code defects. Corrected the identified
  stale credential/backup docs, plus the CI smoke check for archived demo IDs.
- Shell syntax checks and `git diff --check` passed. GitHub's Linux/Node 22 CI and
  remote-main publication are verified separately; no live AI evaluation was run.
