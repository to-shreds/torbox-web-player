# NES game files

Place NES `.nes` files here only when you have permission to host and distribute them. Files in this directory are published with the website, including when its source repository is private. No commercial game files are included in this release.

Add each game to `../games-catalog.json`:

```json
{
  "version": 1,
  "items": [
    {"id": "my-game", "title": "My Game", "rom": "roms/my-game.nes"}
  ]
}
```

Use a simple filename starting with a letter or number, followed by letters, numbers, periods, underscores, or hyphens. Every catalog ROM stays on this website, under `roms/`. External URLs, redirects, archives, and paths outside that directory are rejected. The catalog sorts games by title and supports search. The Games tab also opens a local `.nes` file without uploading it.

The pinned engine is JSNES 2.1.0, licensed under Apache-2.0; its license is in `../vendor/jsnes-2.1.0.LICENSE.txt`. The unmodified minified asset's SHA-256 is `84946f0dae4bcf3b2dfebe84ad3bfeb1dbcb413bd9b1a69e1f45910a95fd7b41`; upstream source is available from <https://github.com/bfirsh/jsnes> and <https://registry.npmjs.org/jsnes/-/jsnes-2.1.0.tgz>. It supports the mapper numbers listed in `../games-core.js`, up to 16 MiB per ROM. Supported iNES and ordinary NES 2.0 headers are checked before loading. Exotic submappers, non-NES consoles, and exponent-encoded NES 2.0 images are rejected rather than guessed. The runner uses NTSC timing; recognized PAL and Dendy headers are rejected.

Touch controls use player 1. Two standard gamepads, or the player 1 arrow/X/Z/Enter/Shift keys and player 2 I/J/K/L/N/M/7/8 keys, can play together on one device. Multiplayer depends on the game. This release has no network multiplayer.

Save states are stored in this browser's IndexedDB, separately for each viewer and the SHA-256 hash of the ROM's bytes. Renaming a ROM preserves its saves. Different games, ROM versions, and viewers have separate saves. Automatic resume saves every 15 seconds and when paused or closed. Manual Save/Load uses a separate slot so automatic saving does not overwrite it. Start fresh resets the running game; the manual save remains available. Saves include in-game battery RAM. Clearing browser data removes saves, and this release does not synchronize them between devices.

Games initially requires an adult viewer so it cannot bypass Kid Mode's viewing limits. Emulation, game input, and saves do not use a TorBox account or backend. Browser audio and full screen require a tap or click; rotating the device adjusts the layout, and screen orientation is never forced.
