# TorBox Player 2.0.8 feature audit

This audit is a source-and-test verification of the canonical browser-local product. It does not substitute for physical Android audio/video acceptance.

## Product contract verified in source and regression tests

- Browser-local TorBox API-key onboarding, optional encrypted device storage, two viewers, sign out, Simple mode default, and Full mode settings.
- Discover browse for movies/shows with Popular/Featured/New and genre filters, focused search, Android Search/Enter keyboard dismissal, movie-and-series cross-type search, and Cinemeta direct/live/Cloudflare fallback.
- Movie/show details, season/episode UI, one-tap automatic Play, separate advanced Options/source chooser, automatic cached/preparation handling, and deterministic unattended episode-file selection.
- Multi-provider source discovery through StremThru Main, StremThru ElfHosted, MediaFusion, and optional Zilean; bounded fan-in; cancellation; short safe-source grace; compatibility-aware ranking before the 40-source cap; distinct variants preserved; 90-second safe-result cache.
- Audio behavior: H.264/AAC strongly preferred; codec-unknown sources remain automatic fallback so normal Play never becomes a torrent-choice prompt; known-risk audio remains last-resort fallback; manual No sound/Bad source learning; Chromium decoded-audio watchdog where exposed.
- Direct TorBox CDN playback, redundant Render/Cloudflare TorBox bridge, advisory TorBox status/outage banner, rate-limit handling, no blocking connection preflight, and no Render media relay.
- Continue Watching/Recently Played with per-item removal confirmation, no Clear All, configurable resume rewind defaulting to 10 seconds, Start Over, completion handling, completed-episode cleanup, and per-viewer progress.
- My List per viewer, removable search history, Next Up, auto-next across seasons, source/quality fallback, recovery, per-title quality, global resolution, source-size profiles, and long-press Quick Actions.
- Native video controls plus custom pause title/time overlay, playback-health panel, sleep timer, Still Watching (90-minute default), wake lock, playback rate, configurable seek shortcuts, buffer/recovery settings, and auto-next countdown.
- Kid Mode with Parent PIN, per-viewer time/episode/movie allowances, daily/manual reset, actual watched-time charging, parent extensions, and protected Settings/viewer/sign-out actions.
- Backendless setup transfer by static/multipart QR, camera scanner, file, or private link; optional AES-GCM password; bounded decompression; rollback on storage failure; metadata hydration; transfer scope limited to credential, ordinary settings, playback history, and My List while destination parental controls remain local.
- Installable PWA, service-worker isolation, version mismatch detection, one-tap repair route, sanitized diagnostics, pinned /key/ fallback, and /direct/ migration.
- Normal discovery does not expose the raw TorBox library. The prior Clear All recent control and blocking TorBox connection checker remain absent. Previously rejected idea 12 (prose source explanation) and idea 13 (replay last 30 seconds) remain absent.

## Audit defect found and repaired

The 2.0.3 through 2.0.7 release mechanism versioned the top-level module graph but several leaf modules still imported dependencies using the stale query `?v=2.0.3`. That could allow a newer UI to mix with an older cached leaf dependency on a device. 2.0.8 versions every relative browser ESM import consistently and adds a test that scans the complete public JavaScript module graph against `package.json` on every release.

The main development server/entry version markers were also stale at 2.0.5 even though the canonical static product was 2.0.7. They are aligned in 2.0.8. These server markers do not control the pinned Render fallback, which remains on its separate pinned branch.

## Verification boundary

Automated tests can establish code paths, source contracts, state behavior, routing, and synthetic browser behavior. They cannot prove that a particular real torrent's audio codec decodes on the user's physical Android device. Physical playback remains an acceptance item and should be described that way.
