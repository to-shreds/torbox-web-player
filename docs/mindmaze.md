# MindMaze integration

The Games catalog includes **MindMaze (Encarta browser recreation)**, hosted by its creator at <https://gorjan.rocks/projects/mindmaze/>. This is a playable browser recreation of the game from Encarta 98, rather than the original Windows program. The Encarta artwork, questions, sound, and executable files are not distributed by this repository.

The author-hosted page was inspected on October 14, 2026. It has no `X-Frame-Options` or `Content-Security-Policy` header preventing its embedding, and its single-page implementation runs without a parent messaging interface. No explicit permission to redistribute the Encarta assets was identified. The integration therefore opens the creator's page directly and names the creator in the player credits.

The catalog accepts exactly one external game URL, `https://gorjan.rocks/projects/mindmaze/`, with the fixed `mindmaze-encarta` ID and matching source credit. Arbitrary external URLs, URL queries, fragments, credentials, encoded paths, and alternative origins are rejected. The app's frame policy permits this host; its main script, connection, and media policies remain separate.

The embedded frame uses `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`. Its opaque origin isolates its content and storage from TorBox. The recreation tolerates unavailable browser storage, but named players fall back to Tourist. The player explains that embedded play uses guest mode without saved names or progress, and offers **Open full page** for the creator's player profiles.

The recreation has no supported pause, mute, restart, or save bridge, so TorBox does not display those controls for it or send it game commands. Fullscreen preserves the existing iframe. Closing, hiding the page, losing browser focus, leaving Games, changing the viewer, enabling the kid profile, or starting movie or sports playback unloads the frame and ends its session. Focusing the embedded frame itself does not close it. Other DOS, browser, and NES games retain their existing controls and save behavior.

Validation includes catalog URL restrictions, sandbox isolation, creator credits and full-page link, unavailable-control visibility, rejected fake status messages, viewer/focus teardown, phone layouts, and fullscreen session preservation. Separate inspection of the actual author page checks desktop and touch navigation through the title, logon, castle, maze, and trivia question screens. It does not establish support for every historical Encarta edition or every device.
