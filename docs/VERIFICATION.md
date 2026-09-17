# Verification report: v0.1.0 integration checkpoint

September 17, 2026. No real TorBox credentials were available during the implementation checks below. This report does not establish account playback or completion of the specification.

## Automated checks actually performed

`npm run check` passed. `npm test` passed all 33 Node tests on Node 22.16.0. The suite covers salted password hashing, session expiry/revocation, login limits, authenticated-route access, secure-cookie flags, exact-origin and CSRF enforcement, owner re-entry, private-cache headers, provider response whitelisting, readiness flags, file ID zero, unsafe URL/key rejection, paging/cache/coalescing, stale snapshots on failure, timeout/rate-limit/error distinctions, fresh link creation, removed files, two-viewer progress isolation, monotonic saves, stale playback rejection and explicit start-over.

The HTTP tests use real requests to a local Node server with a fixture TorBox adapter. Provider tests use explicit synthetic JSON responses and do not call a real account.

## Browser component checks actually performed

Chromium rendered the real browser code with in-memory fixture API responses. Desktop, phone, tablet portrait and tablet landscape layouts had no horizontal overflow. Several episode-sized file rows were visible on the tablet layout. Loaded-file filtering, viewer switching, start-over, logout DOM cleanup and visible provider errors were exercised without uncaught JavaScript errors.

A generated 18-second H.264/AAC MP4, not a TorBox account file, was supplied as a local browser Blob. Chromium decoded its video, sought to 2, 9 and 16 seconds, and applied a fixture-provided resume position when reopened. These are component checks, not proof of audible playback on physical devices, real streaming transport, TorBox CORS/ranges, or account concurrency.

The environment blocked browser navigation to the local HTTP server with `ERR_BLOCKED_BY_ADMINISTRATOR`. No bypass was attempted. Browser component rendering and real local HTTP integration tests were therefore performed separately. A complete browser-to-hosted-server login/playback test was not performed here.

## Not performed or not implemented

No authenticated TorBox account calls, actual library normalization, hosted real-file playback, actual Android device test, real audio verification, cross-IP/CDN/header/range inspection, link-expiry recovery, plan/concurrency verification, source discovery, preparation, conversion/HLS, automatic next, title matching, editable profiles, database migrations, backup/restore or restart durability were verified. Persistent sessions and progress are not implemented; both are temporary server memory.

The deployment result is tracked in the separate ProjectStatus record. A successful Render deployment alone does not establish real account playback. The application intentionally remains locked until its password hash is configured in Render and cannot reach a TorBox account without the separately configured master key.
