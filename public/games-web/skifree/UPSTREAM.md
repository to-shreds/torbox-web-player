# SkiFree browser remake

Adapted from [warboy176/skifree-warboy](https://github.com/warboy176/skifree-warboy), pinned at commit `718df286fb643b26df667b9b764afb724f9a63e6`.

The source `index.html` blob is `07835d5bac056895d96d4ca828c06d346f5bdf51`; the unchanged MIT `LICENSE` blob is `13e41ab17e0bb2f1caad78c0c4e59ab0cab49317`. Both were retrieved from that commit. The pinned source is the compact upstream implementation before later achievement and HUD hooks.

The skier, obstacles and chase creature are drawn in upstream JavaScript with canvas rectangles, polygons and strokes. This bundle contains that MIT-licensed drawing code. It does not bundle the original Chris Pirih Windows executable, extracted SkiFree bitmaps, third-party fonts or recordings. This is a browser remake, not the original Windows game or a DOS program.

Local adaptation separates HTML, CSS and JavaScript for strict CSP; adds authenticated parent messages, adult-viewer checks, explicit pause and stop behavior, touch buttons and readable small-screen panels; validates stored scores; fixes keyboard/pointer priority, airborne crash height and missing ski tracks. The upstream gameplay, collisions, jumps, chase behavior and drawn art are retained. No external runtime requests or audio are required.

Keep the accompanying upstream MIT license and its original copyright notice with redistributed copies.
