# Google Drive share bridge

This tiny Apps Script bridge lets the browser-key clone ask Google for a short-lived `drive.file` OAuth token, make a newly exported file viewable by link, disable reader downloads, and permanently delete the exported copy at the requested time.

The video itself never passes through Apps Script or Render. TorBox uploads directly to Google Drive, and the guest watches from Google Drive.

## One-time setup

1. Open https://script.new while signed in to the Google account whose Drive should receive temporary shares.
2. Replace the default `Code.gs` with this folder's `Code.gs`.
3. Replace `REPLACE_WITH_A_LONG_RANDOM_SECRET_32_CHARS_OR_MORE` with a long random secret you keep private.
4. In Apps Script Project Settings, enable **Show "appsscript.json" manifest file in editor**. Replace its contents with this folder's `appsscript.json`.
5. Run `ping_` once in the editor and approve the requested Google permissions.
6. Deploy > New deployment > Web app. Execute as **Me**. Who has access: **Anyone**.
7. Copy the deployment URL ending in `/exec`.
8. In the TorBox player, open an episode/movie source and choose **Drive test**, then paste the deployment URL and the same secret.

The deployment URL and bridge secret are held only in the current Render login session. They are not committed to GitHub or stored in Render configuration.

## Deletion behavior

When a share is published, the bridge records the Drive file ID and deletion time in Apps Script Properties and creates a time-based trigger. At expiration it calls the Drive API DELETE endpoint, which permanently deletes the temporary exported copy rather than merely revoking its sharing permission.

If a deletion attempt fails, the bridge keeps the pending record and schedules another attempt five minutes later.

## Download behavior

By default, the bridge sets an "anyone with the link" reader permission and applies Google's reader download/copy restriction. The guest can use Drive's browser player, but Drive's download/print/copy controls are disabled for readers. This is not DRM and cannot prevent screen recording.
