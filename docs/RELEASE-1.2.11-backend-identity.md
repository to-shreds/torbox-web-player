# Backend 1.2.11 identity repair

The earlier discovery status path described any missing, malformed or conflicting
torrent hash as a different torrent. An unavailable hash is now distinguished
from an actual conflict. No actual personal TorBox response or credential was
provided, so the screenshot's specific provider condition is not claimed as
reproduced against the user's account.

Missing detail hashes require a fresh account hash/ID proof or a validated,
recent creation acknowledgement. Proofs are account-scoped, capped at 128 and
expire after 30 seconds. An explicit conflicting detail hash cannot be replaced
by a creation proof. Exact-hash stale-ID repair verifies the replacement before
rebinding, never creates a torrent and does not enter the ordinary stale-ID
creation path on repair failure. Unknown proof fails clearly; wrong files are
never accepted by name, title similarity or numeric ID alone.

Concurrency, session revocation, source-ticket expiry, operation replacement,
creation-response account swaps and uncertain writes remain guarded. Only
read-only reconciliation is coalesced; each caller validates its own observed
hash. The frontend and standalone native APK are unchanged.

Checks: npm run check passed. Full Node suite: 704 registered, 698 passed,
zero failed or cancelled, six optional live/account tests skipped. Focused
identity/discovery/recovery suite: all 79 passed, including 17 new identity
cases. Independent adversarial review and execution of the concurrency cases
found no further blocking defect. Live publication is recorded in ProjectStatus.

Contract references: [TorBox Main API](https://api-docs.torbox.app/) documents
creation hash/torrent_id responses and mylist ID-specific requests. The official
[JavaScript SDK model](https://github.com/TorBox-App/torbox-sdk-js/blob/main/documentation/models/GetTorrentListOkResponse.md)
marks the detail hash optional. The change accommodates absence through
independent verification; it does not permit an unverified torrent alias.
