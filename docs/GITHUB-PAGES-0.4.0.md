# GitHub Pages frontend and Render backend

Version 0.4.0 splits hosting without moving TorBox credentials out of Render.

## Architecture

GitHub Pages publishes only the files in `public/`. The static frontend points to `https://torbox-web-player.onrender.com` through public configuration. Render remains the only component that holds the TorBox key, performs catalog/source/TorBox operations, stores process-local progress, and relays protected media.

Cross-origin API authentication uses the existing opaque random session identifier as an explicit Bearer token held in browser `sessionStorage`. Render's old same-origin cookie remains as a fallback for the Render-hosted frontend. Bearer-authenticated mutations still require an approved frontend Origin but do not depend on cross-site cookies. Cookie-authenticated mutations retain CSRF validation.

The configured external frontend origin is `https://to-shreds.github.io`. Render returns that exact CORS origin, never `*`, and does not allow credentialed cross-origin cookies. The GitHub frontend does not send Render cookies.

The HTML5 video element cannot attach the API Authorization header. Playback therefore uses the existing random opaque media ticket as the temporary media bearer. If a valid Render session is presented, the ticket remains session-bound; if no Render session is sent, a valid ticket can be used until expiration or revocation. Logout/revoke removes that session's media tickets. The TorBox CDN URL and master key remain server-side.

## Publishing

`.github/workflows/pages.yml` uploads only `public/` to GitHub Pages. Static assets use project-relative paths. The expected project URL is:

https://to-shreds.github.io/torbox-web-player/

GitHub's current documentation requires Pages to be enabled for the repository before a custom Pages workflow can deploy. The workflow is committed and will deploy automatically on later `public/**` changes once Pages is enabled. The Render-hosted frontend remains a fallback during verification.

## Verification contract

Automated tests cover exact-origin CORS, rejected unapproved origins, login bearer issuance, bearer API access without cookies, explicit-origin mutation protection, cross-origin opaque-media playback, exposed Range headers, wrong-session media rejection, logout revocation, and relative static asset URLs. Existing authentication, discovery, source lookup, TorBox preparation, relay and progress tests remain part of the suite.

A successful Pages workflow establishes static deployment only. It does not establish physical-device video/audio decoding, codec conversion, durable state, or the remaining product features recorded in ProjectStatus.
