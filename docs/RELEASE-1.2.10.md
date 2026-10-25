# Audio reliability repair, 1.2.10

The investigation started from production source `52303d8b33ef30fc37bc8f748cd322865f8ce982`, preserving the 1.2.9 stability work. The October 16 audio repair had not been reverted. It left source-selection and browser-observation gaps that could still produce silent advancing video.

## Reproduced failures

An isolated copy of the previous production source failed four new actual-browser scenarios using original synthetic H.264/EAC3 and H.264/AAC files:

1. A 720p preference selected unknown-audio EAC3 instead of an available 1080p AAC file. Eight unknown-audio candidates could also exclude AAC entirely from the initial shortlist.
2. A fast incomplete lookup opened an unknown-audio file without requesting the completed search containing AAC.
3. Without the native decoded-audio counter, the player chose silent EAC3 despite an available AAC alternative.
4. Without that counter and with only unknown-audio results, automatic playback still started silent video indefinitely.

Default Auto selected AAC in the particular two-candidate fixture and remains a preservation test. Separate behavioral tests reproduced zero-audio monitoring never completing with repeated two-second or four-second callbacks. These observations demonstrate application defects; they do not establish the exact file or physical device involved in Jon's report.

## Repair

Initial Play, Resume, preparation and auto-next share audio-confidence-first ordering across resolution tiers. All automatic recovery paths and the explicit three-choice fallback use consistent ordering. The requested quality remains preferred among candidates with the same audio confidence.

An incomplete search can start promptly when prepared audio is compatible. Otherwise it waits for the existing complete lookup before using unknown audio with native monitoring. Browsers without usable native decoded-audio counters require compatible prepared metadata for unattended playback. They do not invent a decoder failure or a learned success. Unknown metadata can still qualify if preparing the actual selected file exposes compatible codec information.

Stored Sound works feedback may describe a whole torrent, including another episode. It cannot bypass the strict prepared-file audio check. In strict paths, unknown-codec feedback is temporarily demoted before candidate limits so it cannot hide a compatible alternative. This changes ranking copies only; saved feedback is preserved.

The decoder guard now handles clock-consistent callbacks up to five seconds apart, with each observation contributing at most 1.5 seconds to the existing five-second grace period. Paused, muted, seeking, buffering, hidden and long-suspended intervals remain excluded. Decoded silent AAC scenes are valid. No audio-amplitude detector or production Web Audio graph was added, and cross-origin playback still requires no CDN CORS permission.

## Regression and publication gates

The expanded actual-browser audio suite passes all 11 cases on Chrome 151.0.7922.34. The prior source fails four of the five added or replaced cases. The fixed suite also preserves the prior no-CORS EAC3-to-AAC recovery, elapsed position, quiet introduction, cancellation, exhaustion, accidental-feedback repair and absence of the removed No sound controls. All automatic preparations remain cached-only, with zero new torrents and zero backend media fetches.

New Node cases cover source limits, requested-quality preservation, browser capability detection, throttled callbacks, stale torrent-wide feedback, fallback eligibility and deployment gating. Exact final counts and publication evidence are recorded in HANDOFF.md and `docs/evidence/audio-1.2.10/`.

Pages publication continues to depend on the full release verification workflow, including actual-browser audio tests. The deployment checkout is now pinned to `github.sha`, the tested commit, instead of fetching a possibly newer main after verification. The release gate cannot publish a different, untested head. Cache tokens cover every modified playback module, including imports and service-worker entries.

## Published release

Release reliability run [40165592385](https://github.com/to-shreds/torbox-web-player/actions/runs/40165592385) and production Pages run [40165878888](https://github.com/to-shreds/torbox-web-player/actions/runs/40165878888) both succeeded on runtime `30be9731e5d782d795e8692a9a3579a5afaadf0d`, tree `1af7bf5ba808ce8ec1147f59ce722136504c477c`. Each passed 675 registered Node checks, with **669 passing, zero failures and six optional skips**, and **161 of 161 browser cases**: four Trakt, 14 watch-party, 11 audio and 132 core cases. Pages deployment finished at `2026-10-25T05:41:03Z`.

Backend mirror `6e171f13b57d6ffb83b9008ee3919514688e2151` has the identical tested tree. Its CI run 40166202127 passed, and Render deployment `dep-dbf0sitg1s2s73e3cim0` became live at `2026-10-25T14:13:04.644512Z`. After the branch update, repeated checks showed no automatic deployment, queued build or service event, matching the earlier recorded behavior, so one explicit deployment was triggered. No service settings or plan changed.

At `2026-10-25T14:13:22.402466+00:00`, all **32 public root/key asset comparisons** and **15 backend version, authentication, origin and asset checks** passed. Published bytes match the tested source, health reports 1.2.10, and no application errors were returned for the deployment interval through 14:13:23Z. Verification scripts and machine-readable results are retained in `docs/evidence/audio-1.2.10/`.

## Preserved behavior and limits

Direct provider media delivery, zero Render media relay, cached-only unattended selection, title/year/episode/file identity, resume position, the same video DOM element, all saved state, games, Sports, watch-party consent and exact-file restrictions remain intact. The independent native APK is unchanged. Its movie playback/source files were compared with the earlier tested native source and have not changed from 0.2.4 through 0.2.7.

The test media and accounts are synthetic. No personal TorBox account, actual episode, physical Android decoder, phone speaker or Firestick output was tested. Metadata and decoded bytes cannot guarantee every provider file or physical audio route forever. The guard still does not infer a continuing decoder failure after positive decoding, and a watch party still prevents changing to a different source. The previously unresolved physical Android PiP screen timeout and live Trakt activation remain separate.

Rollback sources are retained as `archive/web-before-audio-2026-10-25` and `archive/backend-before-audio-2026-10-25`. Restore their trees as new commits to preserve history and user data.
