# 1.2.9 error and stress-test repair

The review used current main `2df34c7a1868679a855b5c1de3c682ddff453953`, including the later optional Trakt changes. Those changes had failed production verification run 39321568582, leaving the earlier website published. No older project snapshot was substituted.

## Confirmed problems repaired

- The server returned 404 for the two Trakt modules and stylesheet imported by the player. Explicit static routes now serve them. The new HTTP regression failed before the fix.
- Pending refresh, history and queued scrobble results could cross Disconnect/reconnect boundaries. Connection generations now reject obsolete work; concurrent refreshes still share one request.
- A remote episode could replace local progress for the same show. Local show-level history, including completed episodes and backward seeks, takes precedence.
- Missing season values could become season zero, and returned episode IDs were accepted without confirming season/episode identity. Ambiguous and mismatched identities are now rejected; explicit season zero remains valid.
- Two initial vault saves could create different encryption keys, making one viewer unreadable. Device-key initialization now uses an atomic IndexedDB transaction across tabs, and local save/delete operations retain order.
- Overlapping playback events could create duplicate wake locks; late acquisition/release could retain an obsolete lock or erase a current one. Acquisition is shared and guarded by playback identity/generation. Completion of an old episode cannot update newer playback after awaiting release.
- Three assertions in the failed Trakt gate described the old UI/build scheme. They now check the current contracts, including evaluating whether the actual Sports catalog URL is cached.

The encrypted credential format, local history/settings/PIN/game saves, source/audio feedback, exact-file party restrictions and consent, and direct-only media delivery are preserved. No Trakt app registration, credentials or account activation was performed.

## Executed local verification

Syntax and pinned JSNES checks passed. The full Node suite registered 649 tests: 643 passed, zero failed, six optional live-provider checks skipped. Targeted Trakt tests include 100 simultaneous token refresh requests producing one refresh and 100 obsolete queued scrobbles producing no network activity after reconnect. Twelve behavioral wake-lock cases execute the actual player functions with delayed browser grants/releases; nine reproduced failures before correction.

A separate bounded HTTP stress run simulated 96 devices playing 24 episodes each: 2,304 starts and 4,608 seeks. All succeeded, with zero upstream media fetches and zero response media-body bytes. The local fixture measured 128 ms median and 170 ms 95th-percentile batch latency; these are synthetic local-service measurements, not real TorBox or device startup timings. No production service was load-tested.

Native APK 0.2.3 remains independent and unchanged. Fresh Gradle compilation, lint and JVM checks passed: 129 tests passed and one optional test was skipped, then that public metadata test passed separately, completing all 130 distinct cases. Native stress covered 320 title discoveries, 320 cache checks, 200 cancellation/reopen cycles and 18,000 media-policy assertions. Lint has zero errors and 32 warnings. The original package signature and source checksums match; no APK rebuild is warranted. Physical Firestick acceptance and the web player's Android PiP screen-timeout issue remain unverified.

## Release gate and publication

Release gate [40049663759](https://github.com/to-shreds/torbox-web-player/actions/runs/40049663759) passed on exact runtime `8ac16b8aff90cd9f3ed6191497ed7ea00108bd04`, tree `757b7bf7e7f490cc3e68784534e0096035079c49`, at 2026-10-24T01:39:08Z. It passed 643 Node tests (six optional skips) and all **157 browser tests** on native Chromium 151.0.7922.34: four new Trakt cases, 14 party cases, seven audio cases and 132 core cases. Tests cover startup/recovery, Sports/routing, all game platforms and state preservation. Actual browser tests use synthetic media/accounts; they do not establish physical-device or real-account outcomes.

The browser setup failed locally with truncated downloads; native Chrome tests ran in the existing GitHub workflow. The first new four-case Trakt browser run completed its assertions but failed teardown because the test initializer touched sessionStorage on about:blank; the initializer is now restricted to the fixture origin without suppressing application errors. The successful run's browser installation took 6m25s, and the complete required gate finished within its 15-minute allowance.

Production [Pages run 40050802322](https://github.com/to-shreds/torbox-web-player/actions/runs/40050802322) passed the same 643 Node checks (six optional skips) and all 157 browser cases. Deployment finished at 2026-10-24T01:48:48Z. At 2026-10-24T01:50:07.367122+00:00, all **30 root/key asset comparisons** and **11 backend version, authentication, origin and asset checks** passed. Live bytes match the tested source. Render deployment `dep-dbe0panb9u1s73bpssa0` is live from mirror `07632e4a7e49422d8c131250a565e37d5435b4bb`, which uses the identical tested tree; no application errors were returned through 01:49:30Z. Render deployment `dep-dbe0panb9u1s73bpssa0` became live at 2026-10-24T01:41:43.321033Z. Its live health reports 1.2.9 and all three repaired Trakt assets match the tested bytes. No application error logs were returned from deployment start through 01:42:01Z. The backend mirror `07632e4a7e49422d8c131250a565e37d5435b4bb` uses the exact tested tree; its [CI gate](https://github.com/to-shreds/torbox-web-player/actions/runs/40050816227) passed. Repeated deployment checks after the branch update found no automatic Render deployment, matching the service's earlier behavior. One explicit deployment was triggered without changing configuration or plan.

Rollback source branches are `archive/web-before-stress-2026-10-24` and `archive/backend-before-stress-2026-10-24`. Restore an archived tree as a new commit; preserve shared history.

Evidence inventory: `local-checks.json`, `web-stress.log` (explicit summary excerpt), reproduced missing-route and wake-lock logs, release/Pages browser logs and CI summaries, `backend-publication.json`, `publication.json`, and the publication verifier in `docs/evidence/stability-1.2.9/`. All reports distinguish synthetic media/account fixtures from real device/account acceptance.
