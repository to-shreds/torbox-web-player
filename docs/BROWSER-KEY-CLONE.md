# Browser-key clone

This branch is a separate experiment. The production v0.4.2 application on main is not replaced.

## Credential model

The TorBox API key is the login credential. There is no household password and the clone requires no TORBOX_API_KEY or HOUSEHOLD_PASSWORD_HASH environment variable.

On login, the browser sends the key over HTTPS to the clone backend. The backend validates it against TorBox, then retains the key only in that in-memory application session. It is not written to GitHub, Render environment configuration, logs, a database or disk. A Render restart drops it.

The optional Remember checkbox encrypts the key locally in IndexedDB using a non-exportable AES-GCM Web Crypto key stored on that device. If the backend session disappears, the browser can decrypt the remembered key and re-establish a session. Forget saved key deletes both the ciphertext and local CryptoKey.

The API key is still necessarily present in the browser briefly when the user types it or the local vault decrypts it. It is not hard-coded into client JavaScript.

## Why a backend still exists

A read-only GitHub Actions CORS probe on 2026-09-19 tested a normal browser preflight to TorBox user/me with an Authorization header. TorBox responded with HTTP 400 and allowed methods/Authorization headers but did not send Access-Control-Allow-Origin. A browser would therefore block the authenticated API request. The fully static version cannot perform the required TorBox account/control calls directly.

Accordingly this clone keeps a Render bridge. Render receives the user-supplied key transiently and calls TorBox server-to-server. Playback uses an opaque, expiring ticket and a byte-range relay, so the TorBox CDN URL and API key do not reach the browser.

The working main project remains unchanged.
