# Cloudflare backup TorBox relay

The browser-direct player uses Render as its primary TorBox bridge and a Cloudflare Worker as the automatic backup.

## Deployment ownership

Cloudflare deployment credentials are intentionally kept only in the existing `to-shreds/arcade` repository, where `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already configured for the Arcade Worker.

The Arcade repository has a separate workflow that checks out `to-shreds/torbox-web-player` at `browser-direct-experiment` and deploys this Worker source using those existing secrets. No Cloudflare credential is duplicated into the TorBox Web Player repository.

Worker name: `torbox-web-player-relay`

Expected workers.dev URL: `https://torbox-web-player-relay.jonathanjablon.workers.dev`

No TorBox API key is stored in Cloudflare. A user's TorBox key is forwarded only for the individual allowlisted TorBox request.

## Failover behavior

- Render is primary.
- Network errors, timeouts, HTTP 429, and 5xx responses cause reads to retry through Cloudflare.
- After a primary failure, the browser temporarily prefers Cloudflare for two minutes before trying Render first again.
- Authentication and ordinary 4xx errors do not fail over because changing relay cannot fix a bad credential or malformed request.
- Torrent creation is not blindly replayed after an ambiguous failure. The browser checks the TorBox torrent list through the alternate relay first and only sends a second create request if the torrent does not appear.

Both relays expose the same small allowlist:

- `user/me`
- `torrents/checkcached`
- `torrents/mylist`
- `torrents/createtorrent`
- `torrents/requestdl`

The relays do not keep accounts, sessions, history, My List, settings, Kid Mode state, or API keys.
