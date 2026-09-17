# Integration findings and architecture

Checked September 17, 2026. This document records what the current hosted integration actually established and what remains open.

## Authoritative references

- TorBox OpenAPI schema: https://api.torbox.app/openapi.json
- TorBox official SDK endpoint documentation: https://github.com/TorBox-App/torbox-sdk-js/blob/main/documentation/services/TorrentsService.md
- TorBox official library models: https://github.com/TorBox-App/torbox-sdk-js/blob/main/documentation/models/GetTorrentListOkResponse.md
- TorBox web streaming guidance: https://support.torbox.app/en/articles/12662996-torbox-web-streaming
- Render free-tier limits: https://render.com/docs/free
- Render outbound bandwidth: https://render.com/docs/outbound-bandwidth
- Render pricing: https://render.com/pricing

## Real-account findings

The Render service authenticated successfully to the configured TorBox account on September 17, 2026. TorBox reported plan code `1`. The first requested torrent-library page normalized 912 video files and every one of those 912 reported ready. The web-download and Usenet requests normalized no video files. Because the adapter pages provider items and then expands their nested files, 912 is a verified first-page file count, not necessarily the complete account total.

A fresh download-link request for a real ready file returned an HTTPS URL on `store-034.wnam.tb-cdn.io`. TorBox's published allowlist includes `*.tb-cdn.io` and its other `tb-cdn.*` domains. A one-byte request to that URL returned HTTP 206, `Accept-Ranges: bytes`, and a valid `Content-Range`. The tested source identified itself as `video/x-matroska` and was 1,974,660,908 bytes.

The generated CDN URL also contained the account's master API key as the `token` query value. Removing that query parameter and repeating the one-byte request returned HTTP 400. TorBox's published download-link documentation describes the `token` parameter as the API key. Therefore direct browser playback cannot satisfy this project's requirement that the master key remain server-side.

## Secure relay decision

Version 0.2.0 uses a narrowly scoped authenticated relay through the existing Render web service. The browser never supplies an upstream URL. `/api/playback` revalidates a known TorBox video ID, obtains a current server-side CDN URL, creates a random opaque media ticket bound to the current household session, and returns only `/media/<ticket>` to the browser.

The `/media/<ticket>` route accepts authenticated GET or HEAD requests only. It validates a single byte-range request, looks up the server-side ticket, and streams the upstream response without buffering the complete file. Only a small header allowlist is copied to the browser. Redirects are blocked. A 400, 401 or 403 from the upstream URL causes one fresh TorBox resolution and one retry, with no retry loop. Tickets expire and are invalid for other household sessions. Logout and owner revoke-all invalidate their associated tickets.

The Content Security Policy now restricts media to the same origin. No arbitrary-URL proxy exists. The upstream TorBox URL and master key are not present in the playback JSON response.

## Cost consequence

The relay solves the demonstrated credential problem but changes bandwidth economics. Render currently gives a Hobby workspace 5 GB of outbound bandwidth per month and charges $0.15 per additional public-internet GB. The included bandwidth is workspace-wide. Media bytes sent from Render to a viewer count as outbound traffic. A full 2 GB viewing therefore consumes roughly 2 GB of Render outbound bandwidth, plus small protocol overhead; seeking, retrying or replaying sections can increase usage.

The TorBox-to-Render response is inbound to Render. Render's current documentation states that inbound bandwidth is free, while traffic sent from Render is outbound. The relay's material billed component is therefore the video sent from Render to the browser, not a second charge for the inbound video response. Monitor the service and workspace bandwidth metrics before treating the free tier as a regular streaming plan.

## What remains unverified

The live provider check established authentication, library normalization, a real TorBox CDN host and byte-range delivery to Render. Automated HTTP tests established the relay's authentication, range handling, secret non-disclosure and one-time URL renewal behavior with fixtures. This environment still cannot operate an actual Chrome session against the hosted site, so picture, audible sound, browser seeking, resume behavior against the hosted relay and physical Android behavior remain user-device acceptance checks.

The first tested real file is MKV. HTTP range support does not establish that Chrome can decode its video and audio codecs. No TorBox conversion/HLS fallback has been implemented or verified. Account concurrency limits also remain unverified.

Metadata search, broader source discovery, preparation, title/episode matching, automatic next, editable profiles, watchlists and durable Postgres state remain separate later milestones. No discovery provider has been selected solely from assumptions about TorBox.
