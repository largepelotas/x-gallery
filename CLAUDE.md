# X Gallery

A Manifest V3 browser extension that overlays a masonry gallery on the
`x.com/home` timeline. Targets **Brave** first, and any current Chromium browser.
No build step, no dependencies: plain JavaScript loaded straight from `src/`.

Before changing anything in `src/`, read `DESIGN.md`. It holds the data
contracts (the `Post` shape, the store API, the message protocol between worlds)
that every file codes against.

## Commands

- Test: `node --test` (Node 20+; auto-discovers `test/`). Covers the parser and the store, which
  are pure and DOM-free.
- Syntax check everything: `node --check` on each file in `src/` and `dev/`.
- Visual check: `dev/harness.html` fakes X's timeline, pagination, thread
  pages, native buttons and history (routes live in the URL hash), so the whole
  UI runs without an X account. Open it from disk, or serve it with the
  `harness` launch config (`python -m http.server 8765`) and browse to
  `/dev/harness.html`. The Browser pane needs the served one. Its debug bar
  drives Back/Forward, X-style pushes, stalls and ignored navigations.
- Install for real: `brave://extensions` → Developer mode → Load unpacked →
  this folder. Reload the extension and then the x.com tab after each change.

## Invariants

1. **Never call X's API ourselves.** We only read responses the page itself
   requested. Pagination is triggered by scrolling X's own page underneath the
   overlay, and threads load by navigating X's own router to the status page.
   No `fetch` to x.com from extension code, and no replayed or forged GraphQL requests.
2. **Like and repost only by clicking X's native buttons** in X's DOM. Never
   send the mutation ourselves.
3. **The hook is read-only.** `src/hook.js` must never delay, alter, or throw
   into a response the page receives. It clones, reads, posts a message, and
   swallows its own errors.
4. **Render untrusted text with `textContent`, never `innerHTML`.** Post text,
   names, handles and alt text are attacker-controlled. `innerHTML` is allowed
   only for our own static SVG icon strings. Link `href`s must be `http(s):` or
   a site-relative path, never anything else.
5. **The parser never throws on an unexpected shape.** X renames fields often.
   An entry it doesn't understand gets skipped. It never takes down the batch.
6. **Brave compatibility.** No `chrome.sidePanel`, `chrome.offscreen`,
   `storage.sync`, or background service worker. Storage is
   `chrome.storage.local` only. Styles go into the shadow root through
   constructable stylesheets (CSSOM is not subject to X's CSP).
7. **Don't restyle X.** Nothing we do changes X's own DOM or styles. The
   overlay lives in one host element with a shadow root.
8. **Fixtures are synthetic.** Never commit a captured real timeline: no real
   handles, names, post text or media URLs in `test/` or `dev/`.

## Layout

- `manifest.json`: two content-script entries on `https://x.com/*`. One is
  `hook.js` in the MAIN world at `document_start`; the other is everything
  else in the isolated world, also at `document_start`.
- `src/`: one file per concern, all sharing the `globalThis.XG` namespace (see
  DESIGN.md §Files). `parse.js` and `store.js` also export via `module.exports`
  so Node tests can load them.
- `test/`: `node:test` suites plus synthetic GraphQL fixtures.
- `dev/`: the harness. It's not in the manifest and never ships.

## Fragile by nature

X changes its GraphQL shapes and DOM test ids without notice. Selector and
field-path knowledge is concentrated on purpose: response shapes live only in
`parse.js`, and X DOM selectors live only in `native.js` and `hook.js`'s
navigate helper. When X breaks something, fix it there and add a fixture for
the new shape. Don't scatter fallbacks through the UI.
