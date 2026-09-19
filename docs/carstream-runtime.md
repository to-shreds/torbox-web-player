# CarStream runtime contract, checkpoint 1

This is development groundwork for CarStream 2.0, not a completed Android integration or a new production web release. The starting point is canonical web v1.0.0 commit `0b810f493cd19b2210a6bc4525a7c33cb486cfd5`. The normal Internet runtime remains the default. No production Render configuration is changed by this patch.

## Ownership and entry

The canonical repository owns runtime selection, UI, PIN call delegation, storage call sites, source logic, application behavior and the local build transform. CarStream owns `/carstream/host.js`, phone pairing, HTTP endpoints, durable persistence/authorization and all Internet requests. Generated UI files must never be edited independently in CarStream.

The local build reads only committed `public/` blobs from a full commit SHA and emits `TORBOX_WEB_REVISION` plus a per-asset SHA-256 manifest. It removes the remote API-origin setting and PWA link, applies a self-only CSP, and substitutes a generated entry module. That entry awaits `connectRuntime()` from `/carstream/host.js`, installs phone services, then imports the same `app.js`. Missing services leave the loading screen with an error. They do not silently become an unlocked browser-local profile.

The Android server must also supply the CSP as an HTTP header, with `frame-ancestors 'none'`, and serve every asset listed in the generated manifest. The generated manifest explicitly lists the host-provided module; the canonical snapshot alone is not a functioning phone runtime.

## Requests

| Browser operation | Internet runtime | CarStream runtime |
| --- | --- | --- |
| `/api/discover/catalog` and other supported actions | Configured Render origin | Same origin `/tw/api/discover/catalog` |
| Playback media | Approved HTTPS TorBox CDN URL | Same origin `/media/<43-character opaque ID>` |
| Artwork | Catalog HTTPS URL | Same origin `/image/<43-character opaque ID>` |
| Browser bearer session | Existing sessionStorage behavior | Disabled; paired local cookie/session is host-owned |
| Durable app state | Browser localStorage | Injected phone-backed storage adapter |
| Parent PIN | Existing browser PBKDF2 behavior | Injected phone-side verifier/change service |

The `/tw` prefix prevents collisions with existing CarStream `/api/` fallback routes. It does not alter the canonical request/response shapes. Only the actions/methods in `CARSTREAM_API_ACTIONS` are supported. There is no local browser API-key login, TorBox library, owner, Drive, guest-sharing or arbitrary-URL proxy action. The phone must enforce its own allowlist, authorization, response schema and secret sanitization; a frontend allowlist is not a server security boundary.

Local media/image values must be relative opaque paths or the same origin with those paths, without query strings, fragments or credentials. Raw external URLs are rejected, not converted into proxy arguments. Poster references persisted by the application are normalized to relative paths, so they do not encode the changing hotspot IP. Phone-side image-ID mappings still need durable storage.

## Phone bootstrap adapter

`connectRuntime()` must return `{storage, parentPin}` only after successful local pairing and hydration of the phone-authoritative profile.

`storage` supplies synchronous `getItem(key)`, `setItem(key,value)` and `removeItem(key)` against a hydrated mirror, plus asynchronous `flush()`. It must serialize/version pending writes, resolve `flush()` only after durable phone acknowledgment, reject denied/stale writes, and restore the last authorized state on rejection. Critical API mutations, settings saves, viewer changes and parent-extension resume await the checkpoint. A write error must not silently discard limits or become a default unlocked state.

`parentPin` supplies `hasPin()`, `verifyPin(pin)` and `setPin(newPin)`. Verification and key derivation occur on the phone, not through browser Web Crypto. The phone must require a current-PIN proof for changes to an existing PIN, rate-limit attempts, use bounded/scoped authorization for protected state changes, and never return the verifier or persist plaintext PINs. The service contract is not permission to accept a caller's `verified:true` flag.

The existing Kid Mode accounting functions still own the actual allowance rules and use the injected store. Android-side write and playback authorization must prevent reductions/resets/disabling without parent authority, stale snapshots, cross-profile writes and fallback-route bypasses. Those host-side guards are not implemented by this checkpoint.

Viewer identity cannot be a single global selected-viewer value shared by two tablets. Pairing must resolve a stable phone-owned device/profile identity after hotspot-origin changes. Do not infer durable identity from an IP address. Clearing browser storage or reopening a QR must not create a fresh unlimited allowance.

Still Watching, allowance calculations, search focus, keyboard dismissal, source learning, resume and auto-next remain canonical UI behavior. Wake lock, PWA/install, credential vault and Drive controls are gated by runtime capabilities; LAN HTTP does not assume secure-context APIs.

## Supported phone-to-Render authentication

The backend supports `/api/carstream/<action>` only when `AUTH_MODE=api-key` and `CARSTREAM_CLIENT_ENABLED=true`. It remains disabled by default.

A native request supplies `X-CarStream-Client: 2`, no `Origin` or browser Fetch Metadata headers, and JSON for mutations. The version header is not a secret or device attestation. Login validates the real TorBox API key and returns a phone-scoped bearer. Subsequent calls require that bearer; cookies are ignored. Browser sessions cannot use native routes, and native sessions cannot use browser routes. Approved browser Origin and CSRF protections remain unchanged. Do not spoof an approved browser Origin.

Native routes map to the existing discovery/preparation/playback handlers, not a second implementation. Browser-independent native playback progress is namespaced by phone session and viewer. Native playback responses intentionally include the upstream URL for the trusted phone; the Android gateway must replace it with an opaque local media ID before responding to a tablet, remove Render credentials and direct-delivery flags, and relay actual bytes itself.

This commit does not enable the feature on Render. Deployment/configuration and real phone authentication remain acceptance work.

## Verification and limits

The baseline was independently reproduced: 241 tests, 235 passed, zero failures, six optional skips. The checkpoint adds runtime boundaries, phone authentication, state/PIN delegation, generated bundle integrity, deterministic-build and local-entry tests. Existing focused-search tests remain in the full suite. The viewer persistence source assertion was updated to the storage abstraction and supplemented by actual adapter tests; it was not removed.

Automated tests use Node, local HTTP fixtures and injected phone-service doubles. They do not prove Android service persistence, pairing security, HTTP static delivery from the APK, poster/media relay integration, two physical tablets, Chrome codec/audio behavior, live Render/TorBox or Mint classification. Those remain CarStream responsibilities and release gates.
