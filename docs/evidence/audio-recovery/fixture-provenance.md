# Audio recovery fixture provenance

All media is original synthetic video and generated tones. No episode media or TorBox credentials were used.

The original shared `fixture.mp4` was video-only. Its published 1.2.6 SHA-256 was `1e3e7048e67ba8c0343f94288ca031453b257011ccdaae91c8b810ce488084bc`. It is retrievable from commit `34460c5a7434728873b66d6fa8ffb7a6ea5a7c62`. Adding a real AAC track makes existing movie/episode playback fixtures accurately represent their claimed AAC metadata. Decoded video SHA-256 stays `98ff041d861e685ba203909c987eda9b19e76183e85b353963b5ee470beccd08`, and video duration stays exactly 120 seconds. No test explicitly required video-only media.

Reproduction from the repository root, using FFmpeg 6.1.1:

```sh
git show 34460c5a7434728873b66d6fa8ffb7a6ea5a7c62:test/fixtures/fixture.mp4 > /tmp/original-video-only.mp4
ffmpeg -hide_banner -loglevel error -y -i /tmp/original-video-only.mp4 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=120 -t 120 -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -ac 1 -b:a 16k -movflags +faststart test/fixtures/fixture.mp4
ffmpeg -hide_banner -loglevel error -y -i /tmp/original-video-only.mp4 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=12 -t 12 -map 0:v:0 -map 1:a:0 -c:v copy -c:a eac3 -ac 2 -b:a 64k test/fixtures/h264-eac3.mkv
ffmpeg -hide_banner -loglevel error -y -i /tmp/original-video-only.mp4 -f lavfi -i 'aevalsrc=if(lt(t\,8)\,0\,0.15*sin(2*PI*440*t)):s=48000:d=20' -t 20 -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -ac 1 -b:a 32k -movflags +faststart test/fixtures/h264-aac-silent-intro.mp4
```

`fixture-provenance.json` records codec streams, sizes, file SHA-256 values and decoded-video hashes. Matroska includes generated metadata, so its binary hash need not be identical on regeneration; the committed fixture and its recorded hash identify the tested bytes.

`baseline-native-codecs.json` records the initial Chromium 141 comparison: AAC decoded with nonzero PCM; AC3, EAC3 and DTS silently disappeared while video continued with no media error. `baseline-app-silent-eac3.json` records published 1.2.6 incorrectly learning an unknown-audio EAC3 source as successful after 17 seconds with zero decoded audio bytes.

`native-codec-probe.mjs` repeats the four-codec native experiment and writes `native-codecs-current.json`, preserving the baseline report. To reproduce the published application bug, create a detached checkout and run the baseline-only script from the current repository (the script imports the archived fixture/server and generates its own EAC3 clip):

```sh
git worktree add --detach /tmp/torbox-audio-baseline 34460c5a7434728873b66d6fa8ffb7a6ea5a7c62
BASELINE_WORKTREE=/tmp/torbox-audio-baseline CHROME_EXECUTABLE=/tmp/chromium MATROSKA_EVIDENCE_PATH=/tmp/audio-baseline-replay.json node --test docs/evidence/audio-recovery/app-baseline-reproduction.mjs
```

This baseline script expects the bug: zero decoded audio, a continuing Playing state and a learned success. It is intentionally excluded from release acceptance scripts.

`cross-origin-counter-probe.mjs` and its JSON verify actual 307 redirects to a separate HTTP origin without CORS, using the same video element for AAC, EAC3, then AAC. Each source load resets the decoded-byte counter, and only AAC increments it. This small independent probe does not modify or exercise application CSP.

The first actual-app regression uses an independently served synthetic CDN without CORS. Its fixture document adds only that local origin to `media-src`, replacing the production CDN location for the test. Production CSP and delivery policy remain unchanged. Other cases use the inspected empty backend redirect and a synthetic browser media response for PCM analysis. No test sends video bytes through the application server.

These are desktop Chromium tests with a mobile viewport. They establish decoded audio behavior and recovery, not physical Android speaker output or successful playback of the user's real episode.
