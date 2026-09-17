# Playback failure investigation

## Verified live findings

At 2026-09-17T20:58:06Z a bounded Render-hosted diagnostic completed with the real TorBox account. It used an isolated application instance and temporary internal session, not a household viewer's actual progress store. It called the real application's playback and authenticated media routes on loopback. This tests more than the earlier direct-CDN one-byte check, but is not a public-browser test.

The provider page normalized 912 ready video files: 831 MKV, 73 AVI, and 8 MP4. The normalized provider result had no next page. These are counts of the returned normalized videos, not a proof that every possible library namespace or non-video item was inventoried.

An MKV sample and an MP4 sample both returned HTTP 200 playback metadata without the master key, then HTTP 206 through the actual relay route. Each test read exactly 262,144 bytes before cancelling. The MKV header was valid Matroska and contained V_MPEG4/ISO/AVC and A_EAC3 track markers. These indicate H.264 video and E-AC-3 audio, not a complete codec scan or proof that this was the exact file Jon tried.

The documented TorBox `/v1/api/stream/createstream` endpoint was then tested for each sample using Bearer authentication, the existing item/file ID, and scrobbling disabled. Both returned HTTP 500 with the structured provider error `PLAN_RESTRICTED_FEATURE`. The account reported plan code 1. The raw error prose, tokens, upstream URLs, file titles and account identity were not logged or committed.

TorBox's official web-streaming guidance distinguishes non-Pro raw playback of browser-compatible files from its Pro player capabilities: https://support.torbox.app/en/articles/12662996-torbox-web-streaming

The current request contract was verified from the official schema: https://api.torbox.app/openapi.json

## Conclusions and limits

The sampled relay requests work. Browser compatibility remains a separate requirement: relaying a file does not convert its container, video or audio. The generic browser message alone does not identify the exact file or prove its specific failure. The missing conversion implementation and the account's rejected stream-creation requests are verified blockers. They supersede the earlier status that treated this as only a final human-device test.

The appropriate next architecture is a verified browser-compatible conversion path, preferably TorBox's supported service if its account entitlement is enabled. An account upgrade alone will not wire conversion into this app. No subscription change, paid resource, transcoder, or unsupported substitute provider has been provisioned.

## Targeted changes

The frontend now performs one bounded same-origin stream check after a native media error. It distinguishes expired login/tickets, HTTP failures, rate limiting and network interruption from a reachable stream that the browser cannot decode. It does not send a master key to the browser or accept an arbitrary upstream URL. A format/decode failure no longer recommends repeated link renewal. The play-promise handler also no longer labels every rejection as a tap-to-play restriction.

A file-format filter and Show MP4 files action expose MP4 candidates without calling them guaranteed browser-compatible. Search and loaded-page behavior are preserved. This is a usability/diagnostic patch, not a conversion implementation or a claim that the failing file now plays.

## Checks

Fifteen new pure-function tests passed locally on Node 22.16.0. A separate HTTP test was added for the same-origin JavaScript module route; the complete suite runs in Render's normal build. Deployment test totals and final state are recorded in ProjectStatus after the build actually finishes.

Local Chromium component tests used the repository-matching page/styles, real patched frontend logic, and explicit synthetic API/media-error responses. MP4 filtering, preserved search, one diagnostic per error, disabling codec-irrelevant renewal, the Show MP4 files action, and four viewport widths passed with zero uncaught JavaScript errors. These tests do not decode real TorBox media.

Public hosted-site access from this execution environment was unavailable: shell DNS lookup failed and the browsing tool rejected its hosted endpoint. No bypass was attempted. No actual Android or desktop TorBox playback, sound, seek or resume success is claimed.

The startup diagnostic must be disabled again with TORBOX_VERIFY_ON_START=0 after the investigation. Never store the household password or its hash in this repository; Render configuration remains authoritative for credentials.
