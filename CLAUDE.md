# Escape Room (web) - project summary

A vanilla-JS PWA port of the Android app in `../escaperoom` (Kotlin, framework only). Same stories,
same rules. ES modules, no framework, no build step, no npm runtime dependencies. Static, relative
paths (`./`) everywhere so it works under the GitHub Pages sub-path. Dark theme: bg `#14110F`,
text `#EDE3D0`, accent `#D9A441`.

## Layout

- `js/engine.js` - DOM-free game layer, the port of the Kotlin layer (`Story`, `Progress`, `Coins`,
  `Difficulty`, saves). ⚠️ **It is a port: change it together with the Kotlin side** (`../escaperoom/app/src/main/java/com/hrbons/escaperoom/`) and keep method and field names identical.
- ⚠️ **Measuring** (`playMs`/`mistakes` in the save, `Progress.resume()/pause()`, `exportJson`): `app.js` calls `resume/pause` from `setScreen` (room screen only) and on `visibilitychange`; the help panel's "copy play data" feeds `../escaperoom/scripts/calibratie.py`. Rules: `../escaperoom/docs/besluiten/speeltijd-en-fouten-meten.md`. Tests: `test/measure.test.mjs`. `Progress.tour` (look round after the end) is `touring`: unmeasured, and `Saves.save` skips it. Restart (`Saves.clear`) keeps the run in `escaperoom.stats.<id>` (`Progress.archive`), and the export lists it as `run` n.
- `index.html`, `js/app.js`, `css/style.css` - the UI.
- `stories/` - copied from the Android assets by `scripts/sync-assets.py`, which also writes
  `stories/index.json` (the precache list and the plate lookup). Never edit `stories/` by hand.
- `sw.js` - offline. ⚠️ **Bump `CACHE` whenever shipped files change**, or installed copies keep the old ones.
  ⚠️ **`python scripts/check-cache.py` exits 1 when `stories/` or any `SHELL` file differs from `main`/HEAD without a `CACHE` bump** (shell list read from `sw.js`; forgotten once, 2026-10-11). Run it before committing. It diffs the working tree, so on `main` an already-committed change is invisible: pass a ref (`check-cache.py HEAD~1`).
- `manifest.webmanifest`, `icons/` (`scripts/make-icons.py` renders the PNGs).

## Test

`node --test` (engine only), and `node --check sw.js`. Serve statically
(`python -m http.server`) for the UI and the service worker.

## Rules (family)

No ads, no tracking, no network except our own static files. Content rules live in the Android
repo: `../escaperoom/docs/inhoud.md` and `docs/besluiten/`.
