# TorBox Web Player

Private household browser player. **Version 0.2.0 is a secure-relay integration checkpoint, not the finished streaming product.** It is independent of CarStream and the TorBox Android app.

## What this checkpoint contains

The app has one same-origin Node service and a responsive browser interface, household login, owner password re-entry, two fixed viewer slots, paginated TorBox file browsing, loaded-file search, native browser playback controls, temporary resume positions, and a narrowly scoped authenticated media relay. Library, playback, progress and media requests require a valid household session. There is no public registration, source-addition endpoint, or arbitrary-URL proxy.

The relay exists because live TorBox testing showed that the generated CDN URL contains the TorBox master API key in its `token` query parameter. Removing that parameter caused the CDN request to fail. Returning that URL directly to a browser would therefore violate the project's server-side credential requirement. The browser now receives only an opaque same-origin `/media/<ticket>` URL. The corresponding TorBox URL stays in server memory, is bound to the same session, expires, and is never serialized to the client.

**Sessions, media tickets, cache and progress are currently held in memory. A deployment, restart or free-service sleep loses them.** The website displays this limitation. The two viewer slots are fixed, not editable profiles. Search covers loaded account files, not a broader movie catalog. Codec conversion, metadata/posters, automatic next, watchlists, reliable title/episode matching, durable Postgres storage and broader source discovery remain unimplemented.

## Secure setup

1. Deploy this repository as one Render Node web service. Build: `npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm test`. Start: `npm start`.
2. Generate a household password hash at `/setup` or with an equivalent PBKDF2-SHA256 process. Put the hash in `HOUSEHOLD_PASSWORD_HASH` in Render.
3. Put the TorBox API key in `TORBOX_API_KEY` in Render. Never put the real key or password hash in GitHub, browser code, logs, screenshots, or source archives.
4. Sign in with the original household password and test a ready file on a target browser.

Render supplies `RENDER_EXTERNAL_URL`. The server uses it for exact-origin checks. `/healthz` is available. `TORBOX_VERIFY_ON_START` is a diagnostic flag and should be `0` during normal use.

## Verified provider behavior on the current hosted integration

On September 17, 2026, the configured Render service successfully authenticated to the TorBox account. The first torrent-library page normalized 912 video files, all 912 of those files reporting ready. Web-download and Usenet pages returned no videos in that check. This count is the number of normalized video files in the first requested provider page, not a claim that the account contains exactly 912 videos in total.

For a real ready MKV file, TorBox returned `store-034.wnam.tb-cdn.io`, a TorBox-published CDN domain. A one-byte request to the original server-side URL returned HTTP 206 with byte ranges. The same URL without its master-key `token` parameter returned HTTP 400. That result is why v0.2.0 uses the relay rather than direct browser delivery.

The build now has 41 passing automated tests, including authentication, secret non-disclosure, session-bound media tickets, range forwarding, rejection of multipart ranges, one-time renewal of expired upstream links, two-viewer progress isolation and provider failure handling. The hosted startup probe separately verified current TorBox authentication and a real byte-range response. A physical Android/desktop browser still needs to establish actual picture, sound, seeking and resume before the first playback milestone is complete.

## Delivery and cost

The media path is TorBox CDN to Render to the authenticated browser. Render does not store complete video files and streams with backpressure instead of buffering a whole file. The TorBox master key and upstream CDN URL stay server-side.

This relay means video bytes sent from Render to the viewer count as Render outbound bandwidth. Render currently lists 5 GB of included monthly outbound bandwidth for a Hobby workspace and $0.15 per additional GB. A fully watched 2 GB file therefore represents roughly 2 GB of Render-to-viewer outbound traffic, with actual usage affected by seeking, retries and rebuffering. The included allowance is shared across the workspace. Confirm current Render pricing before relying on this architecture for regular high-volume streaming.

The service currently uses free base compute and no database. Free services can sleep after inactivity and ordinary process memory is not durable. No paid resource was provisioned by this checkpoint.

## Recovery and continuity

Rotate the TorBox key or household password hash through Render and redeploy. Restarting revokes this version's memory-only sessions and media tickets. Owner tools can revoke all current sessions. No TorBox media URL is persisted. Postgres migrations, backup/restore and restart durability remain required before the durable household-player milestone is complete.

Application source in this repository controls implementation. Readiness, blockers and the next action are tracked separately in `to-shreds/ProjectStatus`, at `projects/torbox-web-player/STATUS.md`. Read `docs/INTEGRATION.md` and `docs/VERIFICATION.md` before making playback or device-support claims.
