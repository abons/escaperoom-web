# Escape Room (web) - project summary

A vanilla-JS PWA port of the Android app in `../escaperoom` (Kotlin, framework only). Same stories,
same rules. ES modules, no framework, no build step, no npm runtime dependencies. Static, relative
paths (`./`) everywhere so it works under the GitHub Pages sub-path. Dark theme: bg `#14110F`,
text `#EDE3D0`, accent `#D9A441`.

## Layout

- `js/engine.js` - DOM-free game layer, the port of the Kotlin layer (`Story`, `Progress`, `Coins`,
  `Difficulty`, saves). ⚠️ **It is a port: change it together with the Kotlin side** (`../escaperoom/app/src/main/java/com/hrbons/escaperoom/`) and keep method and field names identical.
- `index.html`, `js/app.js`, `css/style.css` - the UI.
- `stories/` - copied from the Android assets by `scripts/sync-assets.py`, which also writes
  `stories/index.json` (the precache list and the plate lookup). Never edit `stories/` by hand.
- `sw.js` - offline. ⚠️ **Bump `CACHE` whenever shipped files change**, or installed copies keep the old ones.
- `manifest.webmanifest`, `icons/` (`scripts/make-icons.py` renders the PNGs).

## Test

`node --test` (engine only), and `node --check sw.js`. Serve statically
(`python -m http.server`) for the UI and the service worker.

## Rules (family)

No ads, no tracking, no network except our own static files. Content rules live in the Android
repo: `../escaperoom/docs/inhoud.md` and `docs/besluiten/`.
