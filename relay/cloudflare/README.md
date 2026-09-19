# Cloudflare backup TorBox relay

The browser-direct player uses Render as its primary TorBox bridge and this Cloudflare Worker as the automatic backup.

## One-time Cloudflare setup

1. In Cloudflare, create an API token scoped to the account that will host this Worker, with permission to edit Cloudflare Workers.
2. In GitHub for `to-shreds/torbox-web-player`, add repository Actions secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
3. In GitHub Actions, run **Deploy Cloudflare backup relay** on the `browser-direct-experiment` branch.

The workflow deploys `relay/cloudflare/worker.js` using Wrangler, reads Cloudflare's deployed `workers.dev` URL, writes that URL into `public/relay-config.json`, pushes the config back to `browser-direct-experiment`, and triggers the GitHub Pages deployment.

No TorBox API key is stored in Cloudflare. A user's key is forwarded only for the individual allowlisted TorBox request.

## Failover behavior

- Render is primary.
- Network errors, timeouts, HTTP 429, and 5xx responses cause reads to retry through Cloudflare.
- After a primary failure, the browser temporarily prefers Cloudflare for two minutes before trying Render first again.
- Authentication and ordinary 4xx errors do not fail over because changing relay cannot fix a bad credential or request.
- Torrent creation is not blindly replayed after an ambiguous failure. The browser checks the TorBox torrent list through the alternate relay first and only sends a second create request if the torrent does not appear.

Both relays expose the same small allowlist:

- `user/me`
- `torrents/checkcached`
- `torrents/mylist`
- `torrents/createtorrent`
- `torrents/requestdl`

The relays do not keep accounts, sessions, history, My List, settings, Kid Mode state, or API keys.
