# Escape Room

A point-and-click escape room game that runs in the browser. Look around a room, tap things, find
items, combine them, crack the codes and get out. Installable as a PWA and fully playable offline.

**Play it: https://abons.github.io/escaperoom-web/**

Pure vanilla JavaScript (ES modules). No framework, no build step, no runtime dependencies.

## Principles

- No ads, no tracking, no accounts.
- No network requests except to this site's own static files.
- Progress and coins are kept in your browser's `localStorage`, nowhere else.

## Run locally

Any static file server will do, for example:

    python -m http.server 8080

then open http://localhost:8080/. (A service worker needs `localhost` or https; opening
`index.html` from disk will play, but not install or work offline.)

Tests of the game engine:

    node --test

## Stories and assets

The stories are copied 1:1 from the Android app (`../escaperoom`) into `stories/` and listed in
`stories/index.json`, which the service worker uses to precache everything:

    python scripts/sync-assets.py

Run it after any change to the stories in the Android repo, then bump `CACHE` in `sw.js`
(`escaperoom-v1` becomes `escaperoom-v2`) so installed copies refresh.

To add a story, follow `docs/inhoud.md` in the Android repo (story format, room plates, items), then sync.

## Icons

`python scripts/make-icons.py` renders the PNG icons from the same door drawing as `icons/icon.svg`
(needs Pillow).

## Deploying

GitHub Pages from the `main` branch root. All paths are relative, so the site works under the
`/escaperoom-web/` sub-path.
