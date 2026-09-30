# Design

The contracts every file codes against. Where this document and the code
disagree, one of them is a bug. Decide which, and fix both.

## How it works

```
X page (MAIN world)                         Extension (isolated world)
─────────────────────                       ──────────────────────────────────
hook.js taps fetch + XHR ──postMessage──▶  content.js ─▶ parse.js ─▶ store.js
  HomeTimeline, HomeLatestTimeline,                         │
  TweetDetail responses                                     ▼
                                                   overlay.js / cards.js / drawer.js
hook.js navigate helper ◀──postMessage──  content.js (open thread)
X's own router renders /status/<id>
X's own DOM buttons ◀──────── element.click() ── native.js (like / repost)
X's own infinite scroll ◀──── window.scrollTo ── content.js pager
```

The overlay covers the viewport. X keeps running underneath it, unmodified.
We watch its responses, drive its scroll position to paginate, drive its router
to open threads, and click its buttons to like and repost.

## Files

Every file is a classic script (content scripts cannot be ES modules) wrapped in
an IIFE that attaches to `const XG = (globalThis.XG ??= {})`. Load order is the
manifest order below; a file may only use namespaces from files before it,
except inside functions called after startup.

| File | Namespace | World | Role |
|---|---|---|---|
| `src/hook.js` | (none) | MAIN | fetch/XHR tap, navigate command |
| `src/parse.js` | `XG.parse` | isolated + Node | GraphQL JSON → `Post` |
| `src/store.js` | `XG.createStore` | isolated + Node | posts, order, filters, pending |
| `src/settings.js` | `XG.settings` | isolated | `chrome.storage.local` wrapper |
| `src/env.js` | `XG.env` | isolated | seams the harness replaces |
| `src/native.js` | `XG.native` | isolated | find X's articles, click like/repost |
| `src/icons.js` | `XG.icons` | isolated | our own SVG strings |
| `src/styles.js` | `XG.styles` | isolated | CSS text for the shadow root |
| `src/masonry.js` | `XG.createMasonry` | isolated | column layout |
| `src/cards.js` | `XG.cards` | isolated | render a Post (grid card, thread post, text) |
| `src/drawer.js` | `XG.createDrawer` | isolated | thread side panel |
| `src/overlay.js` | `XG.createOverlay` | isolated | host, shadow root, toolbar, grid, pill, lightbox, toast |
| `src/content.js` | (entry) | isolated | wiring: bridge, routes, pager, settings |

`parse.js` and `store.js` end with
`if (typeof module !== "undefined") module.exports = <their namespace>;` and use
no DOM, no `chrome.*`, no timers.

Icons are our own simple strokes (heart, repost arrows, reply bubble, bar
chart, play, close, grid). Don't copy X's SVG path data.

## Message protocol (between worlds)

Both directions use `window.postMessage(msg, location.origin)`. Receivers check
`e.source === window` and the `__xg` marker, and ignore everything else.

- page → extension: `{ __xg: "resp", op, url, body }`
  - `op`: `"HomeTimeline" | "HomeLatestTimeline" | "TweetDetail"`
  - `body`: response text. If an XHR had `responseType === "json"`, the hook
    sends `JSON.stringify(xhr.response)`.
- extension → page: `{ __xg: "cmd", cmd: "navigate", path }`, where `path` is
  `/<handle>/status/<id>`.

### hook.js

- URL match: `/\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline|TweetDetail)(?:\?|$)/`
  against the absolute request URL. Keep it host-agnostic.
- fetch: wrap `window.fetch`. The page gets the original `Response`. On match,
  `res.clone().text()` then post. All of it is in try/catch, and a rejection
  in our branch is swallowed.
- XHR: patch `open` to remember the URL (a WeakMap keyed by instance), and
  patch `send` to add a `load` listener when the URL matches. Read
  `responseText` or `response` per `responseType`, and post only on status 200.
- navigate: first look for an `a[href]` in X's DOM whose pathname equals
  `path`, compared case-insensitively. If one exists, `.click()` it so X's
  router handles it natively. Otherwise do `history.pushState(null, "", path)`
  followed by `dispatchEvent(new PopStateEvent("popstate", { state: null }))`.
- Under 100 lines. No other behaviour.

## Post (the normalized shape)

```js
{
  id: "123",                 // rest_id of the DISPLAYED post (the original, for reposts)
  url: "https://x.com/<handle>/status/<id>",
  path: "/<handle>/status/<id>",
  author: { id, name, handle, avatar, verified: bool, following: true|false|null },
  createdAt: 1700000000000,  // ms epoch, from legacy.created_at
  segments: [                // display text, already cleaned (see Text)
    { type: "text", text },
    { type: "link", text: display_url, href: expanded_url },
    { type: "mention", text: "@handle", href: "/handle" },
    { type: "hashtag", text: "#tag", href: "/hashtag/tag" },
  ],
  text: "…",                 // segments joined, for search and length heuristics
  media: [ {
    type: "photo" | "video" | "gif",
    src,                     // media_url_https (photo, or poster for video/gif)
    w, h,                    // original_info; fall back to sizes.large; else 1,1
    alt: string | null,
    durationMs: number | null,
    variants: [ { url, bitrate } ],   // mp4 only, sorted by bitrate ascending; [] for photos
  } ],
  metrics: { replies, reposts, likes, quotes, bookmarks, views: number | null },
  liked: bool, reposted: bool,
  isReply: bool,             // replying to SOMEONE ELSE; self-thread continuations are false
  replyToHandle: string | null,
  repostedBy: { id, name, handle, following } | null,   // set when the entry was a repost
  quote: Post | null,        // one level only; a quote's own quote is dropped
  sensitive: bool,           // legacy.possibly_sensitive
  sortIndex: string | null,  // the timeline entry's sortIndex; null for detail posts
}
```

### Parsing rules (`parse.js`)

- `XG.parse.timeline(json)` → `{ posts: Post[], cursorTop, cursorBottom }`
  - Find `instructions`. Try `data.home.home_timeline_urt.instructions`, then
    a depth-limited (≤ 6) search under `data` for the first array named
    `instructions`.
  - Handle `TimelineAddEntries` (`entries`), `TimelinePinEntry` (`entry`),
    `TimelineReplaceEntry` (cursor replacement), and `TimelineAddToModule`
    (`moduleItems`).
  - `TimelineTimelineItem` with `itemContent.itemType === "TimelineTweet"`
    yields one post. `TimelineTimelineModule` yields its items' posts in order,
    flattened. `TimelineTimelineCursor` entries (or items with
    `cursorType` Top/Bottom) set the cursors. Anything else is skipped.
  - Skip promoted content: entryId starting with `promoted-`, or
    `itemContent.promotedMetadata` present.
  - Each post gets the entry's `sortIndex`. Module items inherit the module's.
  - Dedupe within a batch by `id`, keeping the first.
- `XG.parse.detail(json)` → `{ items, moduleAdds, cursorBottom }`
  - Instructions at `data.threaded_conversation_with_injections_v2.instructions`,
    else the same fallback search.
  - `items`: in order, `{ kind: "post", entryId, post }` for single tweet
    entries, and `{ kind: "module", entryId, posts }` for
    `conversationthread-*` modules.
  - `moduleAdds`: `[{ entryId, posts }]` from `TimelineAddToModule`, to append to
    an existing module.
- `XG.parse.tweet(result)` → `Post | null`, exported for tests.
  - Unwrap `__typename === "TweetWithVisibilityResults"` (use `.tweet`).
    `TweetTombstone`, `TweetUnavailable`, or no `legacy` means `null`.
  - Repost: if `legacy.retweeted_status_result.result` exists, parse that as
    the displayed post and set `repostedBy` from the outer author.
  - Quote: `quoted_status_result.result` goes through the same path, with its
    own `quote` forced to `null`.
  - User fields come from `core.user_results.result`: prefer the newer shape
    (`core.name`, `core.screen_name`, `avatar.image_url`,
    `relationship_perspectives.following`, `verification.verified` or
    `is_blue_verified`), falling back to `legacy.*` (`name`, `screen_name`,
    `profile_image_url_https`, `following`, `verified`). `following` is
    `null` when neither exists.
  - `isReply` = `in_reply_to_status_id_str` present **and**
    `in_reply_to_user_id_str !== author.id`.
  - Views: `views.count` (a string) → number, or `null`.
  - `liked` / `reposted` come from `legacy.favorited` / `legacy.retweeted`.
- `XG.parse.photoUrl(src, size)`: for `pbs.twimg.com` URLs, turn
  `…/ABC.jpg` into `…/ABC?format=jpg&name=<size>` (`small` | `medium` |
  `large` | `orig`). Any other URL is returned unchanged (the harness uses
  data URIs).
- `XG.parse.avatarUrl(src, size)`: replace `_normal.` with `_bigger.` for
  `"large"`; otherwise unchanged.

### Text

1. Source: `note_tweet.note_tweet_results.result.text` if present (long posts;
   its `entity_set.urls` join the url list), else `legacy.full_text`.
2. Slice off the start at `legacy.display_text_range[0]`, counted in code
   points (`Array.from`). This drops auto-inserted reply mentions. Don't
   slice the end by index; step 3 handles trailing media links.
3. Remove every `entities.media[].url` (the t.co link to the media). If
   the post has a quote, also remove `quoted_status_permalink.url`. Trim.
4. Decode `&amp; &lt; &gt; &quot; &#39;`.
5. Segment: split on each url entity's `url` (t.co) string, which gives
   `link` segments (`display_url`, `expanded_url`). In the remaining text
   segments, `@(\w{1,15})` gives `mention` and `#([\p{L}\p{N}_]+)` (with the
   `u` flag) gives `hashtag`.

No index arithmetic beyond step 2. X's indices and its HTML escaping disagree.

## Store (`store.js`)

```js
const store = XG.createStore({ viewerId })   // viewerId: string | null
store.op                        // current timeline op, or null
store.size                      // number of posts held
store.filters                   // { hideReplies, hideReposts, mediaOnly, followingOnly } all bool
store.setFilters(partial)
store.passes(post) -> bool
store.ingestTimeline(op, parsed) -> { reset, appended: Post[], pendingCount, updated: string[] }
store.ingestDetail(parsed) -> { updated: string[] }
store.flushPending() -> Post[]  // pending posts, now at the TOP of the order
store.list() -> Post[]          // display order, unfiltered
store.visible() -> Post[]       // display order, filtered
store.get(id) -> Post | undefined
store.setPostState(id, { liked?, reposted? }) -> Post | undefined   // adjusts the count by ±1 on change
```

- **Op switch:** if `op !== store.op`, clear everything, set `store.op`, and
  report `reset: true`. The user switched between "For you" and "Following".
- **Dedupe:** by `id`. A known id in a new batch updates the stored post's
  `metrics`, `liked` and `reposted` in place and is listed in `updated`. It is
  not re-appended.
- **Newer batch:** when the store is non-empty and every new post has a
  `sortIndex` greater than every stored post's (compare with `BigInt`; a null
  sortIndex never counts as greater), the new posts go to *pending*, not
  the order. `pendingCount` is the pending total. Otherwise new posts are
  appended in arrival order.
- `ingestDetail` only refreshes mutable fields of known posts. Detail posts
  never enter the grid.
- **Filters**, where a post is hidden if any enabled filter rejects it:
  - hideReplies: `post.isReply`
  - hideReposts: `post.repostedBy !== null`
  - mediaOnly: `post.media.length === 0`
  - followingOnly: `post.author.following === false` and
    `post.author.id !== viewerId`. `null` (unknown) **passes**, on purpose.
    If X renames the field, a filter that hid unknowns would silently empty
    the grid. The parser logs one `console.warn` per session when it sees a
    user with neither field.

## Settings (`settings.js`)

`XG.settings.load() -> Promise<{ columns: 3|4|5, filters, enabled: bool }>` and
`XG.settings.save(partial) -> Promise`. The key is `"xg:settings"` in
`chrome.storage.local`. Defaults: 4 columns, all filters off, enabled.
Out-of-range values clamp to defaults.

## Env seams (`env.js`)

Defaults below. The harness replaces `XG.env` before `content.js` runs.

```js
XG.env = {
  route: () => location.pathname,
  scrollPageToBottom: () => window.scrollTo(0, document.documentElement.scrollHeight),
  scrollPageBy: (dy) => window.scrollBy(0, dy),
  viewerId: () => /(?:^|;\s*)twid=u%3D(\d+)/.exec(document.cookie)?.[1] ?? null,
  pageTheme: () => /* "light" | "dim" | "dark" from getComputedStyle(document.body).backgroundColor:
                     rgb(255,255,255) → light, rgb(21,32,43) → dim, else dark */,
};
```

## Native actions (`native.js`)

This is the only file that knows X's DOM test ids.

- `XG.native.findArticle(id)`: among `article[data-testid="tweet"]`, return
  the one whose own permalink is `/status/<id>`. An article's own permalink
  is the first `a[href*="/status/"]` containing a `time` element that is not
  inside a quote card. A quote card is an element with `[role="link"]`
  strictly between the anchor and the article. Match the path with
  `/\/status\/<id>(?:[/?#]|$)/`.
- `XG.native.setLiked(id, want) -> Promise<boolean | null>`
  - Find the button in the article: `[data-testid="like"]` or
    `[data-testid="unlike"]`. If it's already in the desired state, resolve
    `want`. Otherwise `.click()` and wait up to 3 s for the test id to
    flip. Resolve the resulting state, or `null` if the article or button is
    missing.
- `XG.native.setReposted(id, want) -> Promise<boolean | null>`
  - Click `[data-testid="retweet"]` or `[data-testid="unretweet"]`, then wait
    up to 2 s for `[data-testid="retweetConfirm"]` or
    `[data-testid="unretweetConfirm"]` anywhere in the document, and click
    it. If the confirm never appears, dispatch Escape to close any open menu
    and resolve `null`. Otherwise wait for the flip, as for likes.
- Wait with polling at 100 ms or a MutationObserver, whichever is simpler. Never
  both.

## UI

### Overlay (`overlay.js`)

- One host `<div id="xg-host">` appended to `document.documentElement` with
  `position: fixed; inset: 0; z-index: 2147483000; pointer-events: none`,
  holding an open shadow root. Styles come from `XG.styles` via
  `new CSSStyleSheet()` + `replaceSync` + `adoptedStyleSheets`.
- Theme: `data-theme` = `XG.env.pageTheme()`, re-read each time the
  overlay is shown. Tokens (bg, card, border, text, muted, accent, like,
  repost) are defined per theme as CSS custom properties. The font stack is
  `TwitterChirp, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
- Structure: `.xg-root` (pointer-events auto; `display: none` when hidden)
  contains `.xg-scroller` (`overflow-y: auto; overscroll-behavior: contain`),
  which in turn contains the sticky `.xg-toolbar`, the sticky `.xg-newpill`,
  `.xg-grid` and `.xg-footer`. `.xg-root` also holds the drawer, the lightbox
  and a toast. The `.xg-pill` sits outside `.xg-root` and is visible only while
  the gallery is hidden on a page where it could be shown.
- Toolbar, one row 44 px tall:
  - the "Gallery" title
  - a source label: "For you" for HomeTimeline, "Following" for
    HomeLatestTimeline
  - four toggle chips (`aria-pressed`): Hide replies, Hide reposts, Media only,
    Following only
  - a 3 | 4 | 5 segmented column control
  - a "shown / loaded" counter
  - a close button that hides the gallery
- New-posts pill: "N new posts". A click flushes pending, re-lays out, and
  scrolls to the top.
- Footer: the pagination sentinel plus a status line: loading, "Couldn't load
  more" with a Retry button, or idle.
- Empty state (no posts yet): "Waiting for your timeline…". The pager still
  runs, because an empty grid means the sentinel is visible.
- Keyboard: while the overlay is visible, a capture-phase `keydown` listener on
  `window` handles Esc (lightbox, then drawer) and arrow keys in the lightbox.
  It also swallows plain character keys (no ctrl, meta or alt) that don't
  target an editable element, so X's single-key shortcuts (l, t, n, j, k…)
  don't fire on the hidden page.

### Masonry (`masonry.js`)

`XG.createMasonry(gridEl, { columns, gap: 8 })` → `{ setColumns(n), append(els), relayout(els), clear() }`.

- N flex column divs. Each card goes into the column with the smallest
  running height.
- Heights come from a per-card cache keyed by column width. A cache miss
  appends and then measures `offsetHeight` once. A width change (from a
  ResizeObserver on the grid, debounced 150 ms, or from `setColumns`)
  invalidates the cache and triggers a relayout.
- `relayout(els)` rebuilds the columns from existing card elements and never
  re-renders them, so loaded images and GIF state survive a filter or column
  change.
- The media box gets its `aspect-ratio` from `w/h` before load. That's what
  makes a card's height correct at insert time.

### Cards (`cards.js`)

The grid card is media-first and compact:

- **Media**
  - 1 item: full width, `aspect-ratio: w/h` clamped to [0.56, 2.4],
    `object-fit: cover`.
  - 2 items: two square cells.
  - 3 items: the first spans the width at 2:1, then two squares.
  - 4 items: a 2×2 grid of squares.
  - Photos: `photoUrl(src, colWidth > 340 ? "medium" : "small")`, with
    `loading="lazy"` and `decoding="async"`.
  - Video: the poster, a play glyph and a duration badge. It doesn't play in
    the grid.
  - GIF: a `<video muted loop playsinline>` using the first variant. It plays
    only while intersecting (one shared IntersectionObserver) and carries a
    "GIF" badge.
  - `sensitive`: CSS blur plus a small "Show" button that un-blurs without
    opening the drawer.
- **Meta row** (one line, 20 px avatar): name (bold, truncated), `@handle`
  (muted, truncated), `· 3h`. A reply shows a small reply glyph. A repost
  gets a one-line 11 px "↻ <name> reposted" above the meta row.
- **Text:** 13 px/1.35, clamped to 3 lines when there's media and 8 when
  there isn't. Text-only cards use 14 px. Segments render as spans, not
  links, inside the grid.
- **Quote:** a bordered block with a 16 px avatar, name, 2-line text, and a 48 px
  thumbnail of its first media if it has any.
- **Metrics row** at 11 px: reply, repost, like and views counts
  (1.2K / 3.4M; hidden when 0). The like and repost glyphs are tinted when
  `liked` or `reposted`.
- The whole card is an `article tabindex="0"`. Click or Enter opens the drawer.
  Ctrl/⌘-click or middle-click opens `post.url` in a new tab.
  `content-visibility: auto` with `contain-intrinsic-size` sized from the
  estimate.
- `XG.cards.update(el, post)` refreshes the metrics and liked/reposted tint
  in place.

Relative time: `now` under 1 minute, then `5m`, `3h`, `Apr 3`, and
`Apr 3, 2024` for other years. Numbers: `999`, `1.2K`, `12K`, `1.2M`.

### Drawer (`drawer.js`)

`XG.createDrawer(root, deps)` gives `{ open(post), close(), isOpen, focalId, ingestDetail(parsed, focalId), onPostUpdated(post), recheck(), setStatus("idle"|"loading"|"error") }`.
The deps it takes are listed in the header of `src/drawer.js`.

- Fixed to the right: `width: clamp(420px, 36vw, 640px)`, full height, above the
  grid, no backdrop. The grid stays full width underneath, so opening and
  closing never cause a relayout.
- Header: "Post", then "Reply in X", "Open in new tab" and close (×).
  - "Reply in X" hides the whole overlay without changing `enabled`. X is
    already showing the status page underneath, so the user replies natively.
    The pill brings the gallery back, drawer still open.
- Body, in order:
  - ancestors: compact posts
  - the focal post, large: all media at natural ratio, `photoUrl(…, "large")`,
    video with `controls playsinline preload="metadata"` and the highest mp4
    variant ≤ 2.5 Mbps, full text with real links (`target="_blank"`,
    `rel="noopener"`; `http(s)` or site-relative only), full timestamp
    `3:04 PM · Apr 3, 2025`, full metrics, and the action bar
  - reply groups: each module's posts compact, joined by a thin vertical line
  - a sentinel for more replies
- Action bar: Like and Repost buttons show state from the post and call
  `XG.native.setLiked` / `setReposted`.
  - On a boolean result, apply it with `store.setPostState` and refresh the
    grid card too.
  - On `null`, toast "Couldn't reach X's button — open the post in X" and leave
    the state unchanged. No optimistic flip.
  - Compact posts in the drawer get the same two buttons, small, same
    behaviour.
- Clicking a compact post makes it the focal post (the same navigation).
  Clicking a photo opens the lightbox: `photoUrl(…, "orig")`, arrows between
  that post's photos, Esc or a click on the backdrop closes it.
- It renders the focal post immediately from what we have. The thread fills
  in when a TweetDetail response arrives whose `focalTweetId` (from the
  request URL's `variables` query parameter, parsed as JSON) matches. Later
  responses for the same focal post append: `moduleAdds` into their modules,
  and new modules at the end.
  - The parsed thread is cached per focal id in memory, so reopening works when
    X serves the page from its own cache and makes no request.
  - After 8 s with nothing, show "Couldn't load the thread from X." with an
    Open-in-new-tab link.

## Wiring (`content.js`)

- At `document_start`: register the `message` listener immediately and
  buffer responses until the UI is mounted. Mount on `DOMContentLoaded`, or
  immediately if it has already fired, after `XG.settings.load()`.
- **Responses:** Home ops go through `parse.timeline` → `store.ingestTimeline`.
  - On `reset`, clear the grid.
  - Append cards for the `appended` posts that pass the filters.
  - Update the cards listed in `updated`, and the pill count.
  - `TweetDetail` goes through `parse.detail` → `store.ingestDetail` and the
    drawer's `ingestDetail`, with the focal id taken from the URL.
  - Parse errors: `console.warn` once per op, then continue.
- **Navigation model.** We never walk history ourselves. Earlier designs
  counted our entries and called `history.go(-n)` on close. Each version failed
  on a new mix of Back, Forward and X's own pushes, because the extension
  can't see which entries X created. So nothing here infers history depth.
  - `visited`: a `Map` of id → post for every post opened in the drawer this
    session. It is never pruned.
  - **Opening a thread** (from the grid, or a post inside the drawer): add it
    to `visited`, call `drawer.open(post)`, and send `navigate` with its path.
    The navigation stays **in flight** until the route matches that post, or
    2.5 s pass.
  - **Closing the drawer ourselves** (×, Esc): close the drawer. If the route
    isn't `/home`, send `navigate` with path `/home`, which clicks X's own
    Home link, and keep the overlay up while **closing** (until the route
    reads `/home`, or 1.5 s pass). `XG.env.back` is gone. Browser Back after
    × lands on the last thread, which reopens in the drawer. That is
    ordinary history behaviour, and accepted.
    If a navigation is in flight when × is pressed, remember its id for
    2.5 s. If the route then changes to it (the navigation landed
    late), treat that as closing and send `navigate "/home"` rather
    than reopening the drawer.
- **Routes:** poll `XG.env.route()` every 400 ms, and also on `popstate`. Act
  only when the route **changes**, so a closed drawer isn't reopened just
  because the route still names a post. A status route (`/status/<id>`,
  subpaths such as `/photo/1` included, id compared exactly) is **ours** when
  `id` is in `visited`.
  - **Changes to an ours route:** if the drawer isn't already on that id,
    show it from `visited` plus the thread cache, without sending
    `navigate`. That covers Back, Forward and X pushing a post we've
    opened, all the same way. If that id was in flight, it has landed:
    clear the in-flight flag and any error status.
  - **Changes to `/home`:** close the drawer if it's open.
  - **Changes to anything else:** close the drawer. The overlay hides because
    the route is neither home nor ours. The pill stays available only on home
    and ours routes.
  - **In flight, and the 2.5 s pass without the route matching:** X's router
    ignored us. Keep the drawer open on what we have, set its status to
    "Couldn't open this thread in X — like/repost may not work.", and
    `console.warn` the path once. Nothing else changes.
  - Any change of route or drawer focal cancels the pager's waiting state and
    its pending nudges.
- **Visibility:** the overlay is visible when `enabled`, not temporarily
  hidden, and one of these holds:
  - the route is `/home`
  - the drawer is open and the route is ours
  - a navigation is in flight
  - we are closing

  The pill shows when the overlay is hidden and the route is `/home` or
  ours. Clicking it clears the temporary hide. If the route is ours and the
  drawer is closed, it also opens the drawer on that post.
- **Pager.** It drives only the page that is actually underneath.
  - An IntersectionObserver on the grid sentinel (root: the scroller,
    `rootMargin: 0px 0px 1500px 0px`) calls `requestMore("home")`. The
    drawer's own sentinel calls `requestMore("detail")`.
  - `requestMore(kind)`:
    - If the page underneath is wrong, return without marking waiting. For
      `"home"` that means the drawer is open or the route isn't `/home`. For
      `"detail"` it means the route doesn't match the drawer's focal post.
      Re-check the sentinels on every route change.
    - If already waiting, return.
    - Otherwise mark waiting and call `XG.env.scrollPageToBottom()`.
    - If no Home or Detail response (whichever the drawer state wants) arrives
      within 4 s, nudge with `scrollPageBy(-1200)` and then back to the bottom.
      Before each nudge, re-check the page underneath. If it's now the wrong
      page, cancel waiting silently: no nudge and no Retry state.
    - After 3 failed nudges, show the Retry state.
    - Any matching response clears waiting.
    - Once content has been appended, re-check the sentinel on the next frame.
      A tall viewport may still show it.
- **Settings:** the column control, the chips and the close/pill buttons save
  through `XG.settings.save`. A filter change calls `masonry.relayout` with the
  cards of `store.visible()`. Card elements are kept in a `Map` of id → element
  and re-rendered only on reset.

## Harness (`dev/`)

`dev/harness.html` loads a `chrome.storage.local` shim (in memory), the isolated
scripts in manifest order, and `dev/harness.js`, which replaces `XG.env` before
`content.js` runs. The harness page itself plays X:

- It generates synthetic GraphQL responses in the real shapes the parser
  expects: HomeTimeline pages of 20 entries with a mix of single photos at
  varied ratios, 2 to 4 photo posts, videos, GIFs, text-only posts, reposts,
  replies to others and self-replies, quotes, one promoted entry per page,
  conversation modules, followed and non-followed authors, and a sensitive
  post. Media are SVG data URIs, coloured rectangles labelled with their ratio.
  The names are obviously fake (`alice`, `bob`, `carol`, and so on).
- It posts them with the same `{ __xg: "resp" }` messages the hook would send.
  The first page arrives on load. `scrollPageToBottom` triggers the next page
  after 300 ms. A top-cursor "newer" page can be sent from a debug button to
  exercise the pill.
- On a `navigate` command it sets its fake route and fires `popstate`. It
  then posts a synthetic TweetDetail with ancestors, the focal post and
  reply modules, and renders fake `article[data-testid="tweet"]` elements
  with working like/retweet buttons (retweet opens a fake confirm), so
  `native.js` runs for real.
- A small fixed debug bar under the overlay: send newer page, switch op, toggle
  the theme.
