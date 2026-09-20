# TorBox Web Player Handoff

Use this file first when resuming the project. The repository controls implementation. `to-shreds/ProjectStatus/projects/torbox-web-player/STATUS.md` controls readiness and the immediate next action.

## Production baseline

The failed 2.x line is no longer a production candidate. The restored browser-key v1.1 player is the only production baseline.

- Version: **1.1.0**
- Source of truth: `main`
- Render deployment mirror: `browser-key-clone`
- Public app: `https://to-shreds.github.io/torbox-web-player/`
- Legacy URL: `https://to-shreds.github.io/torbox-web-player/key/`
- Render service: `torbox-web-player-key` / `srv-damu91142hec73chb7qg`
- Render URL: `https://torbox-web-player-key.onrender.com`
- PWA cache: `torbox-player-v1.1-restored3`

The Render service is still configured by Render to auto-deploy `browser-key-clone`. Keep that branch runtime-equivalent to `main` until the Render service can be repointed to `main`.

## Simplified playback contract

Simple mode must never open the torrent/source picker as a fallback from Play, Resume, auto-next, or recovery. The source picker is an explicit Full-mode Options tool only.

Automatic playback:

- discovers sources with the bounded provider lookup;
- tries cached sources only;
- never silently starts an uncached download;
- automatically chooses a browser-compatible matching file from a cached multi-file package when the backend has already narrowed the files to the selected movie or episode;
- rejects known unsupported containers before playback; and
- reports a simple failure if no cached browser-compatible source can be opened.

Do not reintroduce automatic `openOptions()`, silent uncached preparation, or the 2.x source-selection path.

## Catalog contract

IMDb Suggest is fallback discovery only. A fallback suggestion must successfully resolve through Cinemeta metadata before it can appear as a clickable card. A Cinemeta 404 is a missing-title condition, not a catalog outage.

This prevents sparse IMDb-only cards such as obscure commercials from appearing in search and then failing with the misleading message “The catalog is unavailable right now.”

## Architecture to preserve

GitHub Pages serves the browser UI. Render performs catalog/search, source discovery, TorBox cache/preparation operations, playback-link generation, and protected byte-range relay. The browser receives only an opaque `/media/<ticket>` path. Do not restore direct TorBox media URLs to the browser.

The relay transports original bytes. There is no transcoding, remuxing, or hidden HLS implementation.

## Current benchmark

The code change represented by this handoff adds four narrow repairs:

1. Simple-mode Play no longer opens the technical source picker.
2. Resume no longer opens the technical source picker either; the production source contains zero automatic `await openOptions(...)` calls and only the two explicit Full-mode Options callbacks remain.
3. Cached multi-file packages can choose a browser-compatible candidate automatically instead of failing solely because more than one matching file exists.
4. IMDb fallback results are metadata-validated before display, and missing Cinemeta metadata is reported as “This title is not available in the catalog.”

GitHub Actions CI run 143 passed for the final runtime mirror commit `cdc9ced5d19ed76e7e169aee6bf85a9297209ba5` with 288 tests registered, 282 passed, 0 failed, and 6 optional live checks skipped. GitHub Pages run 126 succeeded from the equivalent main runtime commit `2caf75b9a026ad3c6eca5ec5b9cd23546f28db20`. Render deploy `dep-dao3ecugekts73ao8leg` is live from `cdc9ced5d19ed76e7e169aee6bf85a9297209ba5`. The runtime files checked on `main` and `browser-key-clone` are byte-identical by Git blob SHA for `public/discover.js`, `lib/catalog.mjs`, `public/sw.js`, and `server.mjs`.

`main` was force-replaced with the restored v1.1 tree. The obsolete failed 2.x refs `audit-2.0.8`, `browser-direct-experiment`, `browser-local-release`, `settings-tabs-2.1.0`, `production-current`, `release-approved`, `release-candidate`, and both `archive/pre-v1-rollback-*` refs were moved to the restored v1.1 commit so they no longer expose the failed 2.x code. The available GitHub connector does not provide branch-ref deletion, so those obsolete branch names remain as aliases rather than retaining 2.x content.

Physical Android acceptance remains required for the Elena of Avalor S2E3 case that exposed the automatic fallback behavior.

## Do not break

- Root and `/key/` must serve the same v1.1 frontend.
- Simple mode must stay torrent-blind.
- Automatic actions may use cached sources only.
- Uncached downloads require an explicit Full-mode Prepare action.
- The TorBox API key and temporary CDN URL remain server-side.
- AVI/MKV and other known unsupported containers must not be sent to Android Chrome as normal playback.
- Search must not show a fallback card that cannot be opened through the catalog.

## Immediate next action

Fully close and reopen the installed site or Chrome tab so the `torbox-player-v1.1-restored3` shell activates. Retest Elena of Avalor S2E3 with one normal Play press. The technical source picker must not appear automatically. If a compatible cached file in the package can be resolved, playback should open directly; otherwise the title view should report that no cached browser-compatible source could be opened. Also repeat the Salute Your Shorts search and confirm the unopenable commercial card is no longer surfaced.
