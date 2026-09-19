# Direct TorBox delivery: v0.4.2

The household owner explicitly chose direct TorBox delivery and accepted exposure of the temporary TorBox playback URL/token in the private browser.

There is no Render video relay or fallback. The running application does not import the relay module, create media tickets, or serve a /media route. Authenticated /api/playback returns the validated TorBox CDN URL directly. If a link expires, New playback link obtains another TorBox URL through the authenticated Render control API. It never falls back to relaying bytes through Render.

GitHub Pages permits media only from TorBox-owned CDN suffixes already verified for this project. Runtime URL validation uses the same suffix allowlist. The Render-hosted fallback frontend has the same media CSP.

Consequences:
- Movie and episode bytes flow TorBox CDN -> browser.
- Render outbound bandwidth is used only for comparatively small API/control responses, not video.
- The TorBox token/key contained in the temporary playback URL is visible to the signed-in browser and its developer/network tools.
- Logout revokes the application session but cannot claw back a TorBox URL already issued to the browser. Its remaining lifetime is controlled by TorBox.
- Browser codec limitations remain. No transcoder was added.

Regression tests explicitly verify that /media returns 404 and that both same-origin and GitHub Pages sessions receive direct TorBox URLs rather than Render media tickets.
