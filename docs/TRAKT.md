# Optional Trakt scrobbling (frontend only)

This is an opt-in integration for the browser player. It uses Trakt OAuth 2.0 with PKCE, direct CORS API requests, device-bound encrypted tokens, and no Render proxy or paid service. No TorBox API credentials, video data, or Trakt tokens are transferred to each other. The Android/Firestick APK is separate and unchanged.

## Trakt registration and use policy

Registration: https://developer.trakt.tv/apps
API use policy: https://developer.trakt.tv/docs/api-use-policy
OAuth callback: https://to-shreds.github.io/torbox-web-player/
JavaScript CORS origin: https://to-shreds.github.io

Trakt forbids use of its API data in an application or website promoting copyright infringement or piracy. Given this project's torrent-discovery and Buffstreams features, obtain Trakt's authorization for this application before connecting an account. This release does not attempt to circumvent Trakt restrictions or registration. A user or operator must provide a public Trakt application Client ID. Do not enter a Client Secret in the website or repository.

## UI

Settings > Trakt scrobbling: Client ID, Connect or Reconnect, Disconnect, Sync now, and independently configurable remote-history display. A small Scrobble switch in the Discover toolbar turns outbound activity on and off for the selected Viewer 1 or Viewer 2. The switch starts disabled until that viewer authorizes Trakt. OAuth redirects back to the main GitHub Pages path, and the sign-in popup takes place at Trakt. Trakt may in turn offer Google sign-in.

Movie scrobbles use IMDb identifiers, and TV episodes require an exact matched Trakt episode ID resolved from the show IMDb ID, season, and episode, never a guessed filename. Calls use the underlying playing, pause, or finished HTML video events; they are asynchronous, throttled, and cannot deliberately block or modify playback.

## History behavior

Local Continue Watching and Next Up remain authoritative and are never overwritten by imported Trakt records. With remote history enabled, unfinished Trakt playback supplements Continue Watching for otherwise absent titles. Exact local matches take precedence. The Trakt playback percentage is only a fallback resume point when there is no local or TorBox bookmark. Completed items from Trakt appear in a separate Recently watched on Trakt section and do not masquerade as resumable items. Remote records and authorization are viewer-scoped. The existing local history format retains its current behavior and is not changed into a per-viewer format by this feature.

Trakt tokens are encrypted separately in IndexedDB with a nonexportable AES-GCM device key. They are not part of setup transfer. Disconnect clears one viewer's local credentials and remote-history cache, attempts a best-effort revoke, and leaves TorBox and the other viewer untouched. For assured revocation, remove the app from authorized applications in Trakt account settings.

## Limits and verification

A developer app and individual Trakt authorization are required to run the live OAuth round trip. Browser CORS, refresh token rotation, actual account scrobbling, and live-history import cannot be claimed tested without those credentials. Trakt can rate-limit or reject events. The player continues normally regardless. Before publishing verify npm tests, browser regression gate, service-worker asset versions and privacy boundaries. There is no live Trakt application Client ID in this repository.

Previous website release and backend rollback identifiers are recorded in HANDOFF.md. The TorBox Render backend and native APK are not modified.
