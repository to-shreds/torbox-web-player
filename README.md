# TorBox Web Player

Private household browser player. **Version 0.1.0 is an integration checkpoint, not the finished streaming product.** It exists to test a real TorBox account through a Render-hosted website before building broader discovery and the durable library experience. It is independent of CarStream and the TorBox Android app.

## What this checkpoint contains

A same-origin Node server and responsive browser interface, household login, owner password re-entry, two independent viewer slots, paginated TorBox file browsing, fresh direct playback links, native browser playback controls, and guarded temporary resume positions. Library, playback and progress APIs require authentication. Provider failures are distinct from empty results. The server never relays video bytes and has no source-addition or arbitrary-URL proxy endpoint.

**Sessions, profiles, cache and progress are currently held in memory. A deployment, restart or free-service sleep loses them.** The website displays this limitation. The two viewer slots are fixed, not editable profiles. Search covers loaded account files, not a broader movie catalog. Codec conversion, metadata/posters, automatic next, watchlists, reliable title/episode matching, durable Postgres storage and source preparation are not implemented.

The initial dependency-free Node and browser implementation deliberately keeps the integration proof small. It does not replace the full specification. Preserve the adapters and verified behavior when adding the durable application. No React/TypeScript migration or database migration is claimed here.

## Secure setup

1. Deploy this repository as one Render Node web service. Use the free instance only for the integration checkpoint. Build: `npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm test`. Start: `npm start`. Node 24 is selected by `.node-version`; Node 22 also runs the local test suite.
2. Open the deployed site's `/setup` page. Choose a unique household password of at least 14 characters. The page generates a salted PBKDF2-SHA256 hash locally using browser WebCrypto. It does not send that password or hash to this server.
3. In this service's Render Environment settings, add `HOUSEHOLD_PASSWORD_HASH` with the complete generated hash and `TORBOX_API_KEY` with the key obtained directly from TorBox. Save and deploy. Never put either real value in GitHub, chat, a source archive, or frontend configuration. The helper page itself cannot change server settings.
4. Open the site, sign in with the original password, and choose a viewer. Owner tools require the password again and show redacted connection information. Test a ready account file before treating playback as working.

Render supplies `RENDER_EXTERNAL_URL`. The server uses it for exact-origin checks. Set `PUBLIC_ORIGIN` only for a deliberate custom HTTPS origin, without a trailing slash. Set `NODE_ENV=production` in Render. The `/healthz` endpoint is available; set it as the dashboard health-check path when configuring the service. `render.yaml` also declares this path for Blueprint deployments.

## Test and run locally

```
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
NODE_ENV=development PORT=10000 npm start
```

This package has no runtime or development dependencies. `.env.example` contains names and placeholders only; the application does not automatically load `.env` files. Tests use explicitly artificial account responses and passwords. `test/serve-fixture.mjs` is a local fixture harness, never the production start command.

## Delivery and cost

The intended request path is browser to Render for authenticated control calls, then browser directly to the validated TorBox HTTPS media URL. The returned temporary video URL is necessarily visible to the authenticated viewer. The TorBox master key stays server-side. No video proxy or transcoder has been provisioned.

The selected integration service uses free base compute and no database. Render's free hours are shared across the workspace, and free services sleep after inactivity. Free-tier selection is not a promise of zero total account charges: bandwidth/build overages and other existing services can affect billing. Review current official pricing before selecting a paid web tier or database. No paid tier is authorized by this checkpoint. See `docs/INTEGRATION.md` for verified references and unresolved integration questions.

## Recovery and continuity

Rotate the TorBox key or household password hash through Render and save/deploy. Restarting revokes this version's memory-only sessions. Owner tools can revoke all sessions without changing the password. Already issued third-party media links remain sensitive and are subject to TorBox's rules; logout does not prove those links were revoked. There is no durable state to back up in this version. Postgres migrations, backup/restore and restart durability must be added and tested before the household-player milestone is complete.

Application source in this repository controls implementation. Readiness, blockers and the next action are tracked separately in `to-shreds/ProjectStatus`, at `projects/torbox-web-player/STATUS.md`. Read `docs/VERIFICATION.md` before making playback or device-support claims.
