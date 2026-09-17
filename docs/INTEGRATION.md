# Integration checkpoint and unresolved questions

Checked September 17, 2026. These are documentation findings and implementation decisions, not account-specific proof.

## Authoritative references

- TorBox's published OpenAPI schema: https://api.torbox.app/openapi.json
- Official SDK endpoint documentation: https://github.com/TorBox-App/torbox-sdk-js/blob/main/documentation/services/TorrentsService.md
- Official SDK library models: https://github.com/TorBox-App/torbox-sdk-js/blob/main/documentation/models/GetTorrentListOkResponse.md
- TorBox web streaming guidance: https://support.torbox.app/en/articles/12662996-torbox-web-streaming
- Render free-tier limits: https://render.com/docs/free
- Render environment configuration: https://render.com/docs/configure-environment-variables
- Render outbound bandwidth: https://render.com/docs/outbound-bandwidth
- Current Node release support: https://nodejs.org/en/about/previous-releases

## Adapter contract

The adapter uses the fixed `https://api.torbox.app/v1/api/` origin. Account and library calls use Bearer authorization. Download-link generation sends the token only in a server-to-server query, requests JSON rather than a redirect, and never returns that API request URL to the browser. Current request schemas were checked separately from older SDK examples. Response normalization still needs validation against an actual account.

The optional `user_ip` parameter is documented for download links. Its existence does not establish IP binding or successful cross-IP playback. This checkpoint first tests an ordinary server-created link without relying on client-supplied forwarding headers. No cross-IP behavior, CORS behavior, CDN redirect chain, byte-range seeking, expiry or account concurrency limit has been verified live.

The older SDK description gives inconsistent one-hour and three-hour link windows. The implementation deliberately does not assume a precise lifetime. It creates a fresh link for each play or explicit renewal and never stores a media URL in progress records.

Only HTTPS URLs on TorBox-owned media host suffixes are accepted by default. The TorBox API host and links containing the master key are rejected. An unexpected CDN hostname is a verification task, not a reason to permit every host. No Render media proxy is present. Direct CDN redirects and media response headers still need live inspection.

TorBox documents streaming-related endpoints and different streaming capabilities for account tiers. A documented endpoint does not establish that this account can convert arbitrary codecs through this application. No HLS/conversion fallback has been implemented or verified.

## First live test

After the two secrets are configured directly in Render, authenticate to the website and check the owner connection status. Confirm a real library page and its readiness fields, then choose a known ready browser-compatible file. Inspect the viewer's browser requests to establish that video goes to TorBox rather than Render and that no request exposes the master key.

On desktop Chrome and an actual Android Chrome device, confirm visible video and audible sound, seek near the beginning, middle and end, pause, reopen the file, and verify the same viewer's position. Use New playback link and verify position retention. Switch viewers and check independence. Temporary progress can survive page reloads only while the same server process remains alive; it is not durable or guaranteed after free-service sleep.

Record response headers, codecs, browser versions and outcomes without saving credentials or private URLs. Exercise an invalid key, removed file, provider error and a network interruption. Record any unsupported file instead of claiming conversion works. Do not introduce a video proxy before a demonstrated need and a verified cost analysis.

## Broader discovery

Metadata search, source search, account membership and playback readiness remain separate requirements. No metadata provider has been selected or connected. TMDB is a candidate, not a dependency. No broader TorBox source-search integration has been verified for this account. A failed attempt to retrieve source-search documentation is not proof that a source API is unavailable. Source entitlements, credentials, attribution, cost, current endpoint contract and actual results must be established before adding Discover or Prepare actions.

## Hosting decision

The integration checkpoint uses one free web service, no database and no media relay. Render free web services sleep after 15 idle minutes and share a monthly free-instance-hour allowance across a workspace. Ordinary process memory is not durable. Existing workspace services also consume that allowance. Bandwidth and build-minute overages can affect account billing under the current plan.

Do not use expiring free Postgres as the final household-state database. Document the then-current recurring web and database costs before paid provisioning. Durable profiles, progress, migrations, backup/restore and restart tests belong to the next application milestone after real playback proof.
