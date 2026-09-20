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
- PWA cache: `torbox-player-v1.1-restored2`

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

The code change represented by this handoff adds three narrow repairs:

1. Simple-mode automatic playback no longer opens the technical source picker.
2. Cached multi-file packages can choose a browser-compatible candidate automatically instead of failing solely because more than one matching file exists.
3. IMDb fallback results are metadata-validated before display, and missing Cinemeta metadata is reported as “This title is not available in the catalog.”

Automated CI and Render verification must be recorded in ProjectStatus after this commit deploys. Physical Android acceptance remains required for the Elena of Avalor S2E3 case that exposed the multi-file fallback behavior.

## Do not break

- Root and `/key/` must serve the same v1.1 frontend.
- Simple mode must stay torrent-blind.
- Automatic actions may use cached sources only.
- Uncached downloads require an explicit Full-mode Prepare action.
- The TorBox API key and temporary CDN URL remain server-side.
- AVI/MKV and other known unsupported containers must not be sent to Android Chrome as normal playback.
- Search must not show a fallback card that cannot be opened through the catalog.
