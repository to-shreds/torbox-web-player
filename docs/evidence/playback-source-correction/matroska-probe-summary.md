# Synthetic Matroska playback experiment

Chromium 141.0.7390.0 on Linux successfully decoded and sought through both H.264/AAC and H.264/Opus Matroska files. An MKV filename alone therefore does not establish that native Chromium playback will fail.

The probe copied H.264 video from the repository's synthetic fixture, added a generated 440 Hz audio track, and served small synthetic files through a local HTTP server with byte-range support. It assigned each URL directly to `video.src`, matching native playback rather than Media Source Extensions. It did not use TorBox credentials or real episodes.

| File | HTTP Content-Type | Video frames and advancing time | Decoded audio | Seek to 6 seconds |
| --- | --- | --- | --- | --- |
| H.264/AAC MP4 | `video/mp4` | Pass | Pass | Pass |
| H.264/AAC MKV | `video/x-matroska` | Pass | Pass | Pass |
| H.264/Opus MKV | `video/x-matroska` | Pass | Pass | Pass |
| H.264/AAC MKV | `video/matroska` | Pass | Pass | Pass |
| H.264/AAC MKV | `application/octet-stream` | Pass | Pass | Pass |

Actual video rendering was observed with `requestVideoFrameCallback`. Web Audio analysis measured nonzero decoded PCM, with peak amplitude about 0.089 to 0.091. Chromium also reported decoded audio bytes and FFmpeg audio/video decoder names. Every case advanced beyond 6.4 seconds after seeking, without media errors. This verifies decoded audio signal, not a human listening test.

`canPlayType('video/x-matroska')` and `canPlayType('video/matroska')` both returned an empty string, including the tested codec-qualified forms. `MediaSource.isTypeSupported` also returned false for those Matroska forms. Those static answers did not prevent successful native `video.src` playback.

[Chromium's official Audio/Video documentation](https://www.chromium.org/audio-video/) lists Matroska among supported containers and explains that codec support also depends on build configuration. The observed playback results are separate empirical evidence for the exact runtime and clips tested here.

The experiment supports replacing an unconditional MKV rejection with bounded native playback eligibility and codec-aware ordering. It does not establish that every MKV file is playable. No physical Android device, Android hardware decoder, HEVC, Dolby/DTS audio, unusual codec profiles, large files, or real CDN was tested. Desktop mobile emulation would not resolve those Android limitations.

Reproduce from the repository root:

```sh
CHROME_EXECUTABLE=/tmp/chromium node docs/evidence/playback-source-correction/matroska-probe.mjs
```

The JSON report contains exact capabilities, per-case playback and seek data, browser media diagnostics, generated-file codec metadata and hashes, FFmpeg commands, and source commit. The log contains the actual experiment stdout. Generated media files remain in `/tmp/torbox-codec-probe` and are reproducible from the script.
