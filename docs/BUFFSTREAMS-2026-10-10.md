# Buffstreams compatibility findings

Source supplied by the user: https://mybuffstreams.plus/ . The root currently redirects to `/home6`. The site lists live/upcoming football and NHL events with player-server choices; those listings are not evidence of archived full games.

## Measured source path

A college-football event page exposed two server IDs, 57831 and 57848. The associated player pages are on `gooz.aapmains.net/new-stream-embed/<id>`. Their public player configuration points to `chatgpt.hereisman.net/playlist/<id>/load-playlist`. The resulting master points to a variant on `red.redirector1.space`; variants return short-lived signed R2 segment URLs. These capability URLs are deliberately omitted from this report and never stored in the app's listing cache.

Both server choices returned a 200 HLS master and variant using the public player Referer, with no Authorization, Cookie, subscription or account. Bounded segment reads returned 206 and MPEG-TS sync byte 0x47. A 1 MiB probe identified H.264 at 1280x720 and AAC. This establishes a plausible native transport/format, not physical Firestick decoder or remote acceptance, a guarantee for every event, or an actual live NFL-game test.

## Browser restriction

Master and variant requests with Origin `https://to-shreds.github.io` returned HTTP 403. The sampled R2 segment returned CORS permission for `https://gooz.aapmains.net`, and no CORS permission for our origin. Thus the existing hls.js browser player cannot read this media directly under the observed provider policies.

The player response also contains a `frame-ancestors` policy limited to the provider's listed partner domains, including `mybuffstreams.plus` but excluding GitHub Pages. A sandboxed frame test in Chrome was rejected with ERR_BLOCKED_BY_RESPONSE and an explicit frame-ancestor error. The temporary Work test context accepted the Work network-proxy certificate; no production TLS policy was weakened. No browser player started. Removing our CSP would not remove the provider's origin/ancestor restrictions.

## Result

The web runtime and its working Sports catalog are unchanged. No Buffstreams tile is published and no video-byte proxy is introduced. Native 0.2.1 is developed separately because native HTTP can supply the public player Referer and is not governed by browser CORS. Its source, tests and artifacts are recorded in the native project. Actual Firestick acceptance remains separate. No Buffstreams replay archive has been verified or implemented.

Site-address changes can be handled in the native connector through a validated HTTPS source setting and bounded redirects. Changes to player/CDN contracts can still require an adapter update. Never treat an arbitrary name-matching mirror as a verified player/CDN or execute downloaded provider JavaScript.
