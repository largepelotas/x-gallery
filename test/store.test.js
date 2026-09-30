"use strict";
// Store tests. Posts are hand-built (the store never looks inside a post beyond the
// fields below). Each test's first comment names the bug it prevents.
const test = require("node:test");
const assert = require("node:assert/strict");
const createStore = require("../src/store.js");

// 19-digit sortIndex strings, like X's. They exceed Number precision on purpose:
// S(100) and S(101) are the same double.
const S = (n) => "7" + "0".repeat(15) + String(n).padStart(3, "0");
const post = (id, sortN, over = {}) => ({
  id: String(id),
  sortIndex: sortN === null ? null : S(sortN),
  author: { id: "u" + id, handle: "h" + id, following: true },
  media: [{ type: "photo" }],
  isReply: false,
  repostedBy: null,
  liked: false,
  reposted: false,
  metrics: { replies: 0, reposts: 0, likes: 10, quotes: 0, bookmarks: 0, views: null },
  ...over,
});
const ingest = (s, posts, op = "HomeTimeline") => s.ingestTimeline(op, { posts });
const ids = (posts) => posts.map((p) => p.id);
const seeded = (viewerId = null) => {
  const s = createStore({ viewerId });
  ingest(s, [post(1, 50), post(2, 40)]);
  return s;
};

// ---- ingest ----------------------------------------------------------------

test("a fresh store starts empty and reports the first batch as a reset", () => {
  // Bug prevented: UI not clearing its "Waiting for your timeline" state, or a crash on op === null.
  const s = createStore();
  assert.deepEqual([s.op, s.size, s.list(), s.visible()], [null, 0, [], []]);
  assert.deepEqual(s.filters, { hideReplies: false, hideReposts: false, mediaOnly: false, followingOnly: false });
  const r = ingest(s, [post(1, 50)]);
  assert.deepEqual([r.reset, ids(r.appended), r.pendingCount, r.updated], [true, ["1"], 0, []]);
  assert.equal(s.op, "HomeTimeline");
});

test("switching op clears posts and pending and reports reset", () => {
  // Bug prevented: "For you" posts lingering under "Following" (or a stale pill count) after a tab switch.
  const s = seeded();
  ingest(s, [post(3, 90)]); // -> pending
  const r = ingest(s, [post(7, 5)], "HomeLatestTimeline");
  assert.equal(r.reset, true);
  assert.equal(r.pendingCount, 0);
  assert.equal(s.op, "HomeLatestTimeline");
  assert.deepEqual(ids(s.list()), ["7"]);
  assert.equal(s.get("1"), undefined);
  assert.deepEqual(s.flushPending(), []);
  assert.equal(ingest(s, [post(8, 4)], "HomeLatestTimeline").reset, false);
});

test("a known id updates metrics, liked and reposted in place and is reported as updated", () => {
  // Bug prevented: stale counts after a refresh, duplicates in the grid, or replacing the object the UI holds.
  const s = seeded();
  const held = s.get("1");
  const r = ingest(s, [
    post(1, 50, { liked: true, reposted: true, metrics: { replies: 1, reposts: 2, likes: 99, quotes: 3, bookmarks: 4, views: 1000 } }),
    post(3, 30),
  ]);
  assert.deepEqual(r.updated, ["1"]);
  assert.deepEqual(ids(r.appended), ["3"]);
  assert.deepEqual(ids(s.list()), ["1", "2", "3"]);
  assert.equal(s.get("1"), held);
  assert.deepEqual(held.metrics, { replies: 1, reposts: 2, likes: 99, quotes: 3, bookmarks: 4, views: 1000 });
  assert.equal(held.liked, true);
  assert.equal(held.reposted, true);
});

test("the same id twice in one batch is appended once", () => {
  // Bug prevented: a duplicated card when a page repeats a post.
  const s = createStore();
  const r = ingest(s, [post(1, 50), post(1, 50), post(2, 40)]);
  assert.deepEqual(ids(r.appended), ["1", "2"]);
  assert.equal(s.size, 2);
});

test("an older page (or one with no news) is appended in arrival order", () => {
  // Bug prevented: pagination results diverted into the "new posts" pill.
  const s = seeded();
  const r = ingest(s, [post(5, 30), post(6, 20)]);
  assert.deepEqual([ids(r.appended), r.pendingCount], [["5", "6"], 0]);
  assert.deepEqual(ids(s.list()), ["1", "2", "5", "6"]);
  const none = ingest(s, []);
  assert.deepEqual([none.appended, none.pendingCount, none.updated, none.reset], [[], 0, [], false]);
});

test("a batch newer than everything held goes to pending; flushPending puts it on top", () => {
  // Bug prevented: a background refresh shoving the grid around under the user's scroll position.
  const s = seeded();
  const r = ingest(s, [post(3, 70), post(4, 60)]);
  assert.deepEqual([r.appended, r.pendingCount], [[], 2]);
  assert.deepEqual(ids(s.list()), ["1", "2"]);
  assert.equal(s.size, 2);
  const flushed = s.flushPending();
  assert.deepEqual(ids(flushed), ["3", "4"]);
  assert.deepEqual(ids(s.list()), ["3", "4", "1", "2"]);
  assert.equal(s.size, 4);
  assert.deepEqual(s.flushPending(), []);
  assert.equal(ingest(s, []).pendingCount, 0);
});

test("a later, newer batch sits above an earlier pending batch", () => {
  // Bug prevented: two refreshes before the user clicks the pill showing the older refresh on top.
  const s = seeded();
  ingest(s, [post(3, 70)]);
  const r = ingest(s, [post(4, 80)]);
  assert.equal(r.pendingCount, 2);
  s.flushPending();
  assert.deepEqual(ids(s.list()), ["4", "3", "1", "2"]);
});

test("after a flush the flushed posts count as held, so an older page is not treated as newer", () => {
  // Bug prevented: a stale "newest" marker leaving a normal older page stuck behind the pill forever.
  const s = seeded();
  ingest(s, [post(3, 70)]);
  s.flushPending();
  const r = ingest(s, [post(9, 60)]); // newer than the old top (50), older than the flushed top (70)
  assert.deepEqual([ids(r.appended), r.pendingCount], [["9"], 0]);
});

test("a pending post seen again is updated, not queued twice", () => {
  // Bug prevented: pill count inflating on every refresh that re-sends the same new post.
  const s = seeded();
  ingest(s, [post(3, 70)]);
  const r = ingest(s, [post(3, 70, { metrics: { replies: 0, reposts: 0, likes: 55, quotes: 0, bookmarks: 0, views: null } })]);
  assert.deepEqual([r.updated, r.pendingCount, r.appended], [["3"], 1, []]);
  assert.equal(s.get("3").metrics.likes, 55);
});

test("a mixed batch (some newer, some older) is appended in arrival order", () => {
  // Bug prevented: splitting one page between the grid and the pill, so scrolling skips posts.
  const s = seeded();
  const r = ingest(s, [post(3, 70), post(4, 10)]);
  assert.deepEqual([ids(r.appended), r.pendingCount], [["3", "4"], 0]);
  assert.deepEqual(ids(s.list()), ["1", "2", "3", "4"]);
});

test("a null or unparseable sortIndex is never newer", () => {
  // Bug prevented: posts with no sortIndex (or garbage) hijacking the pill, or BigInt("abc") throwing.
  const s = seeded();
  assert.deepEqual(ids(ingest(s, [post(3, null)]).appended), ["3"]);
  assert.deepEqual(ids(ingest(s, [post(4, 99), post(5, null)]).appended), ["4", "5"]);
  assert.deepEqual(ids(ingest(s, [post(6, 1, { sortIndex: "abc" })]).appended), ["6"]);
  assert.deepEqual(ids(ingest(s, [post(7, 1, { sortIndex: 5 })]).appended), ["7"]);
  const allNull = createStore();
  ingest(allNull, [post(1, null)]);
  assert.deepEqual(ids(ingest(allNull, [post(2, 500)]).appended), ["2"]);
});

test("sortIndex compares as BigInt: full 19-digit precision and numeric, not lexicographic, order", () => {
  // Bug prevented: Number() rounding merges ids that differ in the last digits; string compare says "99" > "100".
  const s = createStore();
  ingest(s, [post(1, null, { sortIndex: "1800000000000000000" })]);
  assert.equal(ingest(s, [post(2, null, { sortIndex: "1800000000000000001" })]).pendingCount, 1);
  const t = createStore();
  ingest(t, [post(1, null, { sortIndex: "99" })]);
  assert.equal(ingest(t, [post(2, null, { sortIndex: "100" })]).pendingCount, 1);
});

test("garbage arguments never throw", () => {
  // Bug prevented: one malformed message killing the content script's ingest path.
  const s = createStore(null);
  assert.doesNotThrow(() => {
    s.ingestTimeline("HomeTimeline", null);
    s.ingestTimeline("HomeTimeline", { posts: "x" });
    s.ingestTimeline("HomeTimeline", { posts: [null, 1, {}, { id: 5 }, post(1, 5)] });
    s.ingestDetail(null);
    s.ingestDetail({ items: [null, { kind: "post" }, { kind: "module", posts: null }], moduleAdds: [null, {}] });
    s.setFilters(null);
    s.setPostState("nope", null);
  });
  assert.deepEqual(ids(s.list()), ["1"]);
});

// ---- filters ---------------------------------------------------------------

const zoo = () => ({
  reply: post("reply", 1, { isReply: true }),
  repost: post("repost", 2, { repostedBy: { id: "x", name: "X", handle: "x", following: true } }),
  text: post("text", 3, { media: [] }),
  stranger: post("stranger", 4, { author: { id: "s", handle: "s", following: false } }),
  unknown: post("unknown", 5, { author: { id: "k", handle: "k", following: null } }),
  plain: post("plain", 6),
});
const visibleWith = (filters, viewerId = null) => {
  const s = createStore({ viewerId });
  const z = zoo();
  ingest(s, Object.values(z));
  s.setFilters(filters);
  return ids(s.visible());
};

test("filters: each one hides exactly what it should", () => {
  // Bug prevented: a filter wired to the wrong post field, or hiding more than it says.
  assert.deepEqual(visibleWith({}), ["reply", "repost", "text", "stranger", "unknown", "plain"]);
  assert.deepEqual(visibleWith({ hideReplies: true }), ["repost", "text", "stranger", "unknown", "plain"]);
  assert.deepEqual(visibleWith({ hideReposts: true }), ["reply", "text", "stranger", "unknown", "plain"]);
  assert.deepEqual(visibleWith({ mediaOnly: true }), ["reply", "repost", "stranger", "unknown", "plain"]);
  assert.deepEqual(visibleWith({ followingOnly: true }), ["reply", "repost", "text", "unknown", "plain"]);
});

test("filters: combining them hides a post if any enabled filter rejects it", () => {
  // Bug prevented: filters OR-ed the wrong way, so enabling a second one shows posts again.
  assert.deepEqual(visibleWith({ hideReplies: true, hideReposts: true, mediaOnly: true, followingOnly: true }), ["unknown", "plain"]);
});

test("filters: followingOnly passes unknown (null) following and the viewer's own posts", () => {
  // Bug prevented: X renaming the field empties the grid; your own posts vanish because you don't follow yourself.
  const s = createStore({ viewerId: "me" });
  ingest(s, [
    post(1, 3, { author: { id: "me", handle: "me", following: false } }),
    post(2, 2, { author: { id: "o", handle: "o", following: false } }),
    post(3, 1, { author: { id: "n", handle: "n", following: null } }),
  ]);
  s.setFilters({ followingOnly: true });
  assert.deepEqual(ids(s.visible()), ["1", "3"]);
  assert.equal(visibleWith({ followingOnly: true }, null).includes("stranger"), false, "no viewerId must not let strangers through");
});

test("setFilters merges a partial, filters is a copy, and list() ignores filters", () => {
  // Bug prevented: toggling one chip resetting the others; callers mutating store state through `filters`.
  const s = createStore();
  ingest(s, Object.values(zoo()));
  s.setFilters({ hideReplies: true });
  s.setFilters({ mediaOnly: true });
  s.setFilters({});
  s.setFilters({ nonsense: true });
  assert.deepEqual(s.filters, { hideReplies: true, hideReposts: false, mediaOnly: true, followingOnly: false });
  s.filters.hideReposts = true;
  assert.equal(s.filters.hideReposts, false);
  assert.equal(s.list().length, 6);
  assert.equal(s.visible().length, 4);
  assert.equal(s.passes(zoo().reply), false);
  s.setFilters({ hideReplies: false });
  assert.equal(s.passes(zoo().reply), true);
});

// ---- post state ------------------------------------------------------------

test("setPostState adjusts the count by one on change and does nothing when unchanged", () => {
  // Bug prevented: double-counting a like on repeat calls, or drifting counts when X's state already matched.
  const s = seeded();
  assert.equal(s.setPostState("1", { liked: true }).metrics.likes, 11);
  assert.equal(s.setPostState("1", { liked: true }).metrics.likes, 11);
  assert.equal(s.get("1").liked, true);
  assert.equal(s.setPostState("1", { liked: false }).metrics.likes, 10);
  assert.equal(s.setPostState("1", { liked: false }).metrics.likes, 10);
  const both = s.setPostState("2", { liked: true, reposted: true });
  assert.deepEqual([both.metrics.likes, both.metrics.reposts, both.liked, both.reposted], [11, 1, true, true]);
  assert.equal(s.setPostState("2", { reposted: false }).metrics.reposts, 0);
  assert.equal(s.setPostState("2", {}).metrics.likes, 11);
  assert.equal(s.setPostState("2", { liked: "yes" }).liked, true);
});

test("setPostState returns undefined for an unknown id, works on pending posts, and never goes below zero", () => {
  // Bug prevented: a crash on a post that left the store; negative like counts from mismatched data.
  const s = seeded();
  assert.equal(s.setPostState("nope", { liked: true }), undefined);
  ingest(s, [post(3, 70)]); // pending
  assert.equal(s.setPostState("3", { liked: true }).metrics.likes, 11);
  const zero = createStore();
  ingest(zero, [post(1, 5, { liked: true, metrics: { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: 0, views: null } })]);
  assert.equal(zero.setPostState("1", { liked: false }).metrics.likes, 0);
});

// ---- detail ----------------------------------------------------------------

test("ingestDetail refreshes known posts only and never adds to the grid", () => {
  // Bug prevented: thread posts polluting the gallery, or thread views leaving grid counts stale.
  const s = seeded();
  const fresh = post(1, null, { liked: true, metrics: { replies: 9, reposts: 9, likes: 77, quotes: 9, bookmarks: 9, views: 5 } });
  const r = s.ingestDetail({
    items: [{ kind: "post", entryId: "a", post: fresh }, { kind: "post", entryId: "b", post: post(50, null) }, { kind: "module", entryId: "m", posts: [post(2, null, { reposted: true }), post(51, null)] }],
    moduleAdds: [{ entryId: "m", posts: [post(1, null), post(52, null)] }],
    cursorBottom: null,
  });
  assert.deepEqual(r.updated.sort(), ["1", "2"]);
  assert.equal(s.size, 2);
  assert.deepEqual(ids(s.list()), ["1", "2"]);
  assert.equal(s.get("50"), undefined);
  assert.equal(s.get("2").reposted, true);
  assert.equal(s.get("1").metrics.likes, 77, "the first copy in the response wins over a later duplicate");
  assert.equal(s.get("1").liked, true);
});
