"use strict";
// Parser tests. Fixtures are synthetic (CLAUDE.md invariant 8). Each test's first
// comment names the bug it prevents.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/parse.js");
const T = require("./fixtures/tweets.json");
const HOME = require("./fixtures/home-timeline.json");
const DETAIL = require("./fixtures/tweet-detail.json");

// The parser warns once per session about users with no `following` field. That is
// asserted in its own test; everywhere else it is noise.
console.warn = () => {};

const clone = (o) => structuredClone(o);
const ID = (n) => "9000000000000000" + String(n).padStart(3, "0");
const S = (n) => "7" + "0".repeat(15) + String(n).padStart(3, "0");
const ids = (posts) => posts.map((p) => p.id);
const parse = (name, mutate) => {
  const r = clone(T[name]);
  if (mutate) mutate(r);
  return P.tweet(r);
};

const home = (...instructions) => ({ data: { home: { home_timeline_urt: { instructions } } } });
const add = (...entries) => ({ type: "TimelineAddEntries", entries });
const itemContent = (result, extra) => ({ itemType: "TimelineTweet", tweet_results: { result }, ...extra });
const item = (entryId, sortIndex, result, extra) => ({ entryId, sortIndex, content: { entryType: "TimelineTimelineItem", itemContent: itemContent(result, extra) } });
const modItem = (entryId, result, extra) => ({ entryId, item: { itemContent: itemContent(result, extra) } });
const mod = (entryId, sortIndex, items) => ({ entryId, sortIndex, content: { entryType: "TimelineTimelineModule", items } });
const cursor = (type, value) => ({ entryId: `cursor-${type.toLowerCase()}-x`, sortIndex: "1", content: { entryType: "TimelineTimelineCursor", cursorType: type, value } });

// ---- one tweet -------------------------------------------------------------

test("exports: node require and the XG namespace are the same object", () => {
  // Bug prevented: content scripts (XG.parse) and Node tests (require) drifting apart.
  assert.equal(globalThis.XG.parse, P);
  for (const k of ["timeline", "detail", "tweet", "photoUrl", "avatarUrl"]) assert.equal(typeof P[k], "function");
});

test("tweet(): a plain photo post maps every Post field", () => {
  // Bug prevented: a wrong field path silently yields empty/undefined Post fields.
  const p = P.tweet(T.photo);
  assert.deepEqual(Object.keys(p).sort(), [
    "author", "createdAt", "id", "isReply", "liked", "media", "metrics", "path", "quote",
    "replyToHandle", "reposted", "repostedBy", "segments", "sensitive", "sortIndex", "text", "url",
  ]);
  assert.equal(p.id, ID(101));
  assert.equal(p.url, `https://x.com/alice/status/${ID(101)}`);
  assert.equal(p.path, `/alice/status/${ID(101)}`);
  assert.deepEqual(p.author, {
    id: "100001", name: "Alice Example", handle: "alice", verified: true, following: true,
    avatar: "https://pbs.twimg.com/profile_images/FAKEalice/avatar_normal.jpg",
  });
  assert.equal(p.createdAt, Date.UTC(2024, 9, 10, 20, 19, 24));
  assert.deepEqual(p.metrics, { replies: 2, reposts: 4, likes: 120, quotes: 1, bookmarks: 3, views: 12345 });
  assert.equal(p.liked, true);
  assert.equal(p.reposted, false);
  assert.equal(p.isReply, false);
  assert.equal(p.replyToHandle, null);
  assert.equal(p.repostedBy, null);
  assert.equal(p.quote, null);
  assert.equal(p.sensitive, false);
  assert.equal(p.sortIndex, null);
  assert.deepEqual(p.media, [
    { type: "photo", src: "https://pbs.twimg.com/media/FAKEm1.jpg", w: 2048, h: 1365, alt: "A fake harbor", durationMs: null, variants: [] },
  ]);
});

test("tweet(): liked, reposted and sensitive come from the viewer/flags, not the counts", () => {
  // Bug prevented: liked/reposted read from the wrong field, or inferred from a non-zero count.
  const p = parse("photo", (r) => {
    r.legacy.favorited = false;
    r.legacy.retweeted = true;
    r.legacy.possibly_sensitive = true;
  });
  assert.equal(p.liked, false);
  assert.equal(p.reposted, true);
  assert.equal(p.sensitive, true);
  assert.equal(P.tweet(T.sensitive).sensitive, true);
});

test("tweet(): TweetWithVisibilityResults is unwrapped", () => {
  // Bug prevented: limited-visibility posts (wrapper object has no `legacy`) vanish from the grid.
  const p = P.tweet(T.visibility);
  assert.equal(p.id, ID(113));
  assert.equal(p.text, "Behind a fake interstitial");
});

test("tweet(): tombstone, unavailable, missing legacy and a wrapped tombstone are null", () => {
  // Bug prevented: a deleted/suspended post renders as an empty card, or throws.
  for (const k of ["tombstone", "unavailable", "noLegacy"]) assert.equal(P.tweet(T[k]), null, k);
  assert.equal(P.tweet({ __typename: "TweetWithVisibilityResults", tweet: T.tombstone }), null);
});

test("tweet(): a post without a usable author or id is skipped", () => {
  // Bug prevented: a post with no handle builds a broken /undefined/status/... permalink.
  assert.equal(parse("photo", (r) => delete r.core.user_results.result.core), null);
  assert.equal(parse("photo", (r) => (r.core.user_results.result.core.screen_name = "../evil")), null);
  assert.equal(parse("photo", (r) => { r.rest_id = "abc"; r.legacy.id_str = "abc"; }), null);
});

test("tweet(): a repost displays the original and records who reposted", () => {
  // Bug prevented: showing "RT @carol: ..." under the reposter, with the reposter's (zero) counts.
  const p = P.tweet(T.repost);
  assert.equal(p.id, ID(102));
  assert.equal(p.author.handle, "carol");
  assert.equal(p.text, "Fake clip of a fake cat");
  assert.deepEqual(p.repostedBy, { id: "100002", name: "Bob Example", handle: "bob", following: false });
  assert.equal(p.metrics.likes, 120);
  assert.equal(p.media[0].type, "video");
  assert.equal(P.tweet(T.video).repostedBy, null);
});

test("tweet(): a repost of an unavailable original is skipped", () => {
  // Bug prevented: falling back to the outer "RT @..." text when the original is gone.
  const r = clone(T.repost);
  r.legacy.retweeted_status_result.result = T.tombstone;
  assert.equal(P.tweet(r), null);
});

test("tweet(): a quote is parsed one level deep and the nested quote is dropped", () => {
  // Bug prevented: unbounded quote recursion (quote of a quote of a quote...) bloating every Post.
  const p = P.tweet(T.quote);
  assert.equal(p.quote.id, ID(108));
  assert.equal(p.quote.author.handle, "alice");
  assert.equal(p.quote.text.startsWith("Quoting bob"), true);
  assert.equal(p.quote.quote, null);
});

test("tweet(): a quote behind a visibility wrapper still parses; an unavailable quote is null", () => {
  // Bug prevented: quotes of limited-visibility posts crash or drop the outer post.
  const wrapped = clone(T.quote);
  wrapped.quoted_status_result.result = { __typename: "TweetWithVisibilityResults", tweet: wrapped.quoted_status_result.result };
  assert.equal(P.tweet(wrapped).quote.id, ID(108));
  const gone = clone(T.quote);
  gone.quoted_status_result.result = T.tombstone;
  const p = P.tweet(gone);
  assert.equal(p.id, ID(107));
  assert.equal(p.quote, null);
});

test("tweet(): isReply is true for a reply to someone else, false for a self-thread", () => {
  // Bug prevented: self-thread continuations hidden by "Hide replies", or replies shown as originals.
  const other = P.tweet(T.replyOther);
  assert.equal(other.isReply, true);
  assert.equal(other.replyToHandle, "alice");
  const self = P.tweet(T.replySelf);
  assert.equal(self.isReply, false);
  assert.equal(self.replyToHandle, null);
  assert.equal(P.tweet(T.photo).isReply, false);
});

// ---- users -----------------------------------------------------------------

test("tweet(): user fields parse in the newer shape and the legacy shape", () => {
  // Bug prevented: only one of X's two user shapes is understood, so half the authors are blank.
  assert.deepEqual(P.tweet(T.video).author, {
    id: "100003", name: "Carol Example", handle: "carol", verified: false, following: false,
    avatar: "https://pbs.twimg.com/profile_images/FAKEcarol/avatar_normal.jpg",
  });
  assert.deepEqual(P.tweet(T.replyOther).author, {
    id: "100002", name: "Bob Example", handle: "bob", verified: true, following: false,
    avatar: "https://pbs.twimg.com/profile_images/FAKEbob/avatar_normal.jpg",
  });
});

test("tweet(): the newer user shape wins over legacy fields; legacy fills gaps", () => {
  // Bug prevented: stale legacy.* values overriding the current core/avatar/relationship_perspectives.
  const both = parse("photo", (r) => {
    r.core.user_results.result.legacy = { name: "STALE", screen_name: "stale", following: false, verified: false, profile_image_url_https: "https://pbs.twimg.com/STALE_normal.jpg" };
  });
  assert.equal(both.author.name, "Alice Example");
  assert.equal(both.author.handle, "alice");
  assert.equal(both.author.following, true);
  assert.equal(both.author.avatar, "https://pbs.twimg.com/profile_images/FAKEalice/avatar_normal.jpg");
  const gap = parse("photo", (r) => {
    const u = r.core.user_results.result;
    delete u.avatar;
    delete u.relationship_perspectives;
    u.legacy = { following: false, profile_image_url_https: "https://pbs.twimg.com/LEGACY_normal.jpg" };
  });
  assert.equal(gap.author.avatar, "https://pbs.twimg.com/LEGACY_normal.jpg");
  assert.equal(gap.author.following, false);
});

test("tweet(): `following` is null when neither shape carries it", () => {
  // Bug prevented: an unknown following state read as false, so "Following only" empties the grid.
  assert.equal(P.tweet(T.entities).author.following, null);
  const legacyNone = parse("gif", (r) => delete r.core.user_results.result.legacy.following);
  assert.equal(legacyNone.author.following, null);
  assert.equal(parse("gif", (r) => (r.core.user_results.result.legacy.following = true)).author.following, true);
});

test("parse: warns once per session, not once per post, about users with no `following`", () => {
  // Bug prevented: console spam on every post, or silence when X renames the field.
  delete require.cache[require.resolve("../src/parse.js")];
  const fresh = require("../src/parse.js");
  const calls = [];
  const saved = console.warn;
  console.warn = (...a) => calls.push(a);
  try {
    fresh.tweet(T.photo);
    assert.equal(calls.length, 0, "a user with the field must not warn");
    fresh.tweet(T.entities);
    fresh.tweet(clone(T.entities));
    fresh.timeline(HOME);
    assert.equal(calls.length, 1);
  } finally {
    console.warn = saved;
  }
});

// ---- text ------------------------------------------------------------------

test("text: note_tweet supplies the full text and its urls", () => {
  // Bug prevented: long posts truncated at ~280 chars with a dead "x.com/i/web/status" link.
  const p = P.tweet(T.noteTweet);
  assert.ok(p.text.length > 280);
  assert.ok(p.text.includes("Sentence 12 of a fake long post"));
  assert.ok(!p.text.includes("FAKEself") && !p.text.includes("…"));
  assert.deepEqual(p.segments.find((s) => s.type === "link"), { type: "link", text: "example.invalid/long", href: "https://example.invalid/long" });
  const legacyOnly = parse("noteTweet", (r) => delete r.note_tweet);
  assert.ok(legacyOnly.text.length < 300 && legacyOnly.text.includes("…"));
});

test("text: the auto-inserted reply mention prefix is sliced off", () => {
  // Bug prevented: every reply starting with "@alice @carol" repeated in the card text.
  const p = P.tweet(T.replyOther);
  assert.equal(p.text, "Great shot!");
  assert.deepEqual(p.segments, [{ type: "text", text: "Great shot!" }]);
});

test("text: the reply slice counts code points, so an emoji before the cut does not break it", () => {
  // Bug prevented: slicing by UTF-16 units leaves a lone surrogate and eats the wrong characters.
  const before = parse("replySelf", (r) => {
    r.legacy.full_text = "\u{1F600}\u{1F600} hello world";
    r.legacy.display_text_range = [3, 14];
  });
  assert.equal(before.text, "hello world");
  const after = parse("replySelf", (r) => {
    r.legacy.full_text = "@alice \u{1F389} party";
    r.legacy.display_text_range = [7, 15];
  });
  assert.equal(after.text, "\u{1F389} party");
});

test("text: the t.co link to our own media is removed, including when several photos share it", () => {
  // Bug prevented: "https://t.co/xxxx" printed at the end of every media post.
  assert.equal(P.tweet(T.photo).text, "Sunset over the fake harbor with @bob #sunset");
  const three = parse("photo", (r) => {
    const m = r.legacy.entities.media[0];
    const list = [m, { ...m, media_url_https: "https://pbs.twimg.com/media/FAKEm1b.jpg" }, { ...m, media_url_https: "https://pbs.twimg.com/media/FAKEm1c.jpg" }];
    r.legacy.entities.media = list;
    r.legacy.extended_entities.media = list;
  });
  assert.equal(three.media.length, 3);
  assert.ok(!three.text.includes("t.co"));
});

test("text: the quote permalink is removed only when the quote is shown", () => {
  // Bug prevented: a stray "x.com/alice/status/..." link under every quote post.
  const p = P.tweet(T.quote);
  assert.equal(p.text, "Look at this");
  assert.deepEqual(p.segments, [{ type: "text", text: "Look at this" }]);
  assert.ok(!p.text.includes("FAKEq1"));
});

test("text: HTML entities are decoded exactly once", () => {
  // Bug prevented: "&amp;" showing literally, or "&amp;lt;" collapsing to "<" (double decode).
  const p = P.tweet(T.entities);
  assert.ok(p.text.startsWith('Fish & chips <3 > "tea" it\'s ok.'));
  const twice = parse("replySelf", (r) => {
    r.legacy.full_text = "&amp;lt;b&amp;gt; and &amp;amp;";
    r.legacy.display_text_range = [0, 0];
  });
  assert.equal(twice.text, "&lt;b&gt; and &amp;");
});

test("text: segments split into text, link, mention and hashtag (unicode hashtags included)", () => {
  // Bug prevented: links/mentions/hashtags rendered as plain text, or a non-ASCII hashtag cut short.
  const p = P.tweet(T.entities);
  assert.deepEqual(p.segments, [
    { type: "text", text: "Fish & chips <3 > \"tea\" it's ok. Docs: " },
    { type: "link", text: "example.invalid/docs", href: "https://example.invalid/docs" },
    { type: "text", text: " cc " },
    { type: "mention", text: "@erin_x", href: "/erin_x" },
    { type: "text", text: " thanks " },
    { type: "hashtag", text: "#日本語", href: "/hashtag/日本語" },
    { type: "text", text: " and " },
    { type: "hashtag", text: "#fake_tag", href: "/hashtag/fake_tag" },
  ]);
  assert.equal(p.text, p.segments.map((s) => s.text).join(""));
  assert.equal(p.text, 'Fish & chips <3 > "tea" it\'s ok. Docs: example.invalid/docs cc @erin_x thanks #日本語 and #fake_tag');
});

test("text: an email address or mid-word # is not a mention or hashtag", () => {
  // Bug prevented: "bob@example.invalid" becoming a link to the profile "@example".
  const p = parse("replySelf", (r) => {
    r.legacy.full_text = "mail bob@example.invalid, see (#tag) and @carol.";
    r.legacy.display_text_range = [0, 0];
  });
  assert.deepEqual(p.segments, [
    { type: "text", text: "mail bob@example.invalid, see (" },
    { type: "hashtag", text: "#tag", href: "/hashtag/tag" },
    { type: "text", text: ") and " },
    { type: "mention", text: "@carol", href: "/carol" },
    { type: "text", text: "." },
  ]);
});

test("text: a link whose expanded_url is not http(s) never becomes a javascript: href", () => {
  // Bug prevented: attacker-controlled entity data injecting a javascript: URL (invariant 4).
  const p = parse("replySelf", (r) => {
    r.legacy.full_text = "click https://t.co/FAKEbad";
    r.legacy.display_text_range = [0, 0];
    r.legacy.entities.urls = [{ url: "https://t.co/FAKEbad", expanded_url: "javascript:alert(1)", display_url: "evil" }];
  });
  for (const s of p.segments) if (s.href !== undefined) assert.match(s.href, /^(https?:\/\/|\/)/);
  assert.equal(p.segments.find((s) => s.type === "link").href, "https://t.co/FAKEbad");
});

// ---- media / counts --------------------------------------------------------

test("media: a video keeps its poster, duration and mp4 variants sorted by bitrate", () => {
  // Bug prevented: the HLS playlist or the unsorted variant list reaching <video>; wrong "best variant" pick.
  const m = P.tweet(T.video).media[0];
  assert.equal(m.type, "video");
  assert.equal(m.src, "https://pbs.twimg.com/ext_tw_video_thumb/FAKEm2/pu/img/FAKEposterm2.jpg");
  assert.equal(m.durationMs, 15015);
  assert.equal(m.alt, null);
  assert.deepEqual(m.variants.map((v) => v.bitrate), [256000, 832000, 2176000]);
  assert.ok(m.variants.every((v) => v.url.includes(".mp4")));
});

test("media: an animated gif is type gif with one mp4 variant and no duration", () => {
  // Bug prevented: "animated_gif" not recognized, so GIF posts render as broken photos.
  const m = P.tweet(T.gif).media[0];
  assert.equal(m.type, "gif");
  assert.equal(m.durationMs, null);
  assert.deepEqual(m.variants, [{ url: "https://video.twimg.com/tweet_video/FAKEm3.mp4", bitrate: 0 }]);
  assert.equal(m.w, 480);
});

test("media: w/h fall back to sizes.large, then to 1x1", () => {
  // Bug prevented: a card with no aspect ratio (NaN/0 height) collapsing or breaking the layout math.
  const noInfo = parse("photo", (r) => delete r.legacy.extended_entities.media[0].original_info);
  assert.deepEqual([noInfo.media[0].w, noInfo.media[0].h], [2048, 1365]);
  const badInfo = parse("photo", (r) => (r.legacy.extended_entities.media[0].original_info = { width: 0, height: "x" }));
  assert.deepEqual([badInfo.media[0].w, badInfo.media[0].h], [2048, 1365]);
  const none = parse("photo", (r) => {
    const m = r.legacy.extended_entities.media[0];
    delete m.original_info;
    delete m.sizes;
  });
  assert.deepEqual([none.media[0].w, none.media[0].h], [1, 1]);
});

test("media: variants without content_type mp4 are dropped; missing bitrate is 0", () => {
  // Bug prevented: non-mp4 sources chosen for playback, or NaN bitrates breaking the sort.
  const p = parse("video", (r) => {
    r.legacy.extended_entities.media[0].video_info.variants = [
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/FAKE.m3u8" },
      { content_type: "video/mp4", url: "https://video.twimg.com/FAKEnobitrate.mp4" },
      { bitrate: 100, content_type: "video/mp4", url: "https://video.twimg.com/FAKE100.mp4" },
      { bitrate: 50, content_type: "video/webm", url: "https://video.twimg.com/FAKE50.webm" },
    ];
  });
  assert.deepEqual(p.media[0].variants.map((v) => v.bitrate), [0, 100]);
});

test("media: unknown media types and media without a url are skipped; entities.media is the fallback", () => {
  // Bug prevented: one odd media item discarding the post, or a card with a blank <img>.
  const odd = parse("photo", (r) => {
    const good = r.legacy.extended_entities.media[0];
    r.legacy.extended_entities.media = [{ ...good, type: "hologram" }, { ...good, media_url_https: "" }, good];
  });
  assert.equal(odd.media.length, 1);
  const fallback = parse("photo", (r) => delete r.legacy.extended_entities);
  assert.equal(fallback.media.length, 1);
  assert.equal(parse("photo", (r) => { delete r.legacy.extended_entities; delete r.legacy.entities.media; }).media.length, 0);
});

test("metrics: views is a string converted to a number, or null", () => {
  // Bug prevented: views "12345" left as a string (breaks formatting), or missing views shown as 0.
  assert.equal(P.tweet(T.photo).metrics.views, 12345);
  assert.equal(P.tweet(T.video).metrics.views, 88000);
  assert.equal(parse("photo", (r) => (r.views = { count: "3400000", state: "EnabledWithCount" })).metrics.views, 3400000);
  assert.equal(parse("photo", (r) => delete r.views).metrics.views, null);
  assert.equal(parse("photo", (r) => (r.views = { state: "Disabled" })).metrics.views, null);
  assert.equal(parse("photo", (r) => (r.views = { count: "" })).metrics.views, null);
  assert.equal(parse("photo", (r) => (r.views = { count: "lots" })).metrics.views, null);
});

test("metrics: missing or malformed counts become 0", () => {
  // Bug prevented: NaN or undefined counts reaching the formatter.
  const p = parse("photo", (r) => {
    delete r.legacy.reply_count;
    r.legacy.retweet_count = "7";
    r.legacy.favorite_count = null;
    r.legacy.quote_count = "x";
    delete r.legacy.bookmark_count;
  });
  assert.deepEqual(p.metrics, { replies: 0, reposts: 7, likes: 0, quotes: 0, bookmarks: 0, views: 12345 });
});

// ---- timeline --------------------------------------------------------------

test("timeline(): the fixture yields the right posts, in order, with sortIndex", () => {
  // Bug prevented: entries reordered, dropped or mis-tagged when a real-shaped response is parsed end to end.
  const r = P.timeline(HOME);
  assert.deepEqual(ids(r.posts), [101, 102, 113, 105, 106, 103, 107, 104, 110].map(ID));
  assert.deepEqual(r.posts.map((p) => p.sortIndex), [100, 99, 97, 95, 95, 90, 89, 88, 87].map(S));
  assert.equal(r.posts[1].repostedBy.handle, "bob");
  assert.equal(r.cursorTop, "FAKE_TOP_CURSOR");
  assert.equal(r.cursorBottom, "FAKE_BOTTOM_CURSOR");
});

test("timeline(): promoted entries are skipped by entryId and by promotedMetadata", () => {
  // Bug prevented: ads appearing in the gallery, whichever way X flags them.
  const r = P.timeline(home(add(
    item(`promoted-tweet-${ID(1)}-x`, S(9), T.gif),
    item(`tweet-${ID(2)}`, S(8), T.video, { promotedMetadata: { impressionId: "fake" } }),
    mod("home-conversation-x", S(7), [modItem("a", T.replyOther), modItem("b", T.replySelf, { promotedMetadata: { impressionId: "fake" } }), modItem(`promoted-tweet-${ID(3)}`, T.entities)]),
    item(`tweet-${ID(101)}`, S(6), T.photo),
  )));
  assert.deepEqual(ids(r.posts), [ID(105), ID(101)]);
  const fixture = ids(P.timeline(HOME).posts);
  assert.ok(!fixture.includes(ID(114)) && !fixture.includes(ID(111)));
});

test("timeline(): a conversation module is flattened in order and inherits the module sortIndex", () => {
  // Bug prevented: module posts lost, reordered, or given no sortIndex (breaking "newer" detection).
  const r = P.timeline(home(add(mod("home-conversation-x", S(50), [modItem("a", T.replySelf), modItem("b", T.tombstone), modItem("c", T.replyOther)]))));
  assert.deepEqual(ids(r.posts), [ID(106), ID(105)]);
  assert.deepEqual(r.posts.map((p) => p.sortIndex), [S(50), S(50)]);
  const fixture = P.timeline(HOME).posts;
  assert.deepEqual(fixture.filter((p) => [ID(105), ID(106)].includes(p.id)).map((p) => p.sortIndex), [S(95), S(95)]);
});

test("timeline(): duplicate ids within a batch keep the first", () => {
  // Bug prevented: the same post twice in one page, or the later (stale) copy overwriting the first.
  const r = P.timeline(HOME);
  const first = r.posts.filter((p) => p.id === ID(101));
  assert.equal(first.length, 1);
  assert.equal(first[0].metrics.likes, 120);
  assert.equal(first[0].sortIndex, S(100));
});

test("timeline(): top and bottom cursors are read; other cursor types and later replacements are handled", () => {
  // Bug prevented: pagination cursor lost, or a ShowMore/Gap cursor mistaken for the bottom cursor.
  const r = P.timeline(home(add(cursor("Top", "T1"), cursor("Bottom", "B1"), cursor("ShowMore", "SM"), cursor("Gap", "GAP"))));
  assert.deepEqual([r.cursorTop, r.cursorBottom], ["T1", "B1"]);
  const replaced = P.timeline(home(
    add(cursor("Bottom", "OLD")),
    { type: "TimelineReplaceEntry", entry_id_to_replace: "cursor-bottom-x", entry: cursor("Bottom", "NEW") },
  ));
  assert.equal(replaced.cursorBottom, "NEW");
  const viaItem = P.timeline(home(add({ entryId: "c", sortIndex: "1", content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelineTimelineCursor", cursorType: "Bottom", value: "VIA_ITEM" } } })));
  assert.equal(viaItem.cursorBottom, "VIA_ITEM");
  assert.deepEqual(P.timeline(home(add(item("t", S(1), T.gif)))), { posts: [Object.assign(P.tweet(T.gif), { sortIndex: S(1) })], cursorTop: null, cursorBottom: null });
});

test("timeline(): TimelinePinEntry and TimelineAddToModule instructions contribute posts", () => {
  // Bug prevented: posts delivered through pin/add-to-module instructions silently never appearing.
  const r = P.timeline(home(
    { type: "TimelinePinEntry", entry: item(`tweet-${ID(101)}`, S(50), T.photo) },
    { type: "TimelineAddToModule", moduleEntryId: "home-conversation-x", prepend: false, moduleItems: [modItem("m", T.gif)] },
  ));
  assert.deepEqual(ids(r.posts), [ID(101), ID(103)]);
  assert.deepEqual(r.posts.map((p) => p.sortIndex), [S(50), null]);
});

test("timeline(): unknown instruction and entry types are ignored without throwing", () => {
  // Bug prevented: a new X entry type (or an unexpected instruction) taking down the whole batch.
  const r = P.timeline(home(
    { type: "TimelineClearCache" },
    { type: "TimelineSomethingNew", entries: [item("t", S(9), T.gif)] },
    add(
      { entryId: "weird", sortIndex: S(8), content: { entryType: "TimelineTimelineWeird", itemContent: itemContent(T.video) } },
      { entryId: "prompt", sortIndex: S(7), content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelinePrompt", tweet_results: { result: T.photo } } } },
      { entryId: "user", sortIndex: S(6), content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelineUser", user_results: { result: {} } } } },
      item("ok", S(5), T.replySelf),
    ),
  ));
  assert.deepEqual(ids(r.posts), [ID(106)]);
});

test("timeline(): one throwing entry does not take down the batch", () => {
  // Bug prevented: a single malformed/hostile entry aborting the parse of a whole page (invariant 5).
  const poisonedEntry = { entryId: "tweet-poison", sortIndex: S(9) };
  Object.defineProperty(poisonedEntry, "content", { enumerable: true, get() { throw new Error("boom"); } });
  const poisonedTweet = clone(T.gif);
  Object.defineProperty(poisonedTweet.legacy, "full_text", { enumerable: true, get() { throw new Error("boom"); } });
  const r = P.timeline(home(add(item("a", S(10), T.photo), poisonedEntry, item("b", S(8), poisonedTweet), item("c", S(7), T.video))));
  assert.deepEqual(ids(r.posts), [ID(101), ID(102)]);
});

test("timeline()/detail()/tweet(): garbage input yields an empty result and never throws", () => {
  // Bug prevented: X sending an error body, HTML, or a reshaped payload and the parser throwing.
  const bad = [
    undefined, null, 0, 42, "", "not json", true, [], [1, 2], {}, { data: null }, { data: 5 }, { data: {} }, { data: { home: null } },
    { data: { home: { home_timeline_urt: { instructions: "nope" } } } },
    { data: { home: { home_timeline_urt: { instructions: [null, 1, "x", [], {}, { type: 5 }, { type: "TimelineAddEntries", entries: "x" }] } } } },
    home(add(null, 1, "x", [], {}, { content: null }, { content: { entryType: "TimelineTimelineItem", itemContent: null } },
      { content: { entryType: "TimelineTimelineModule", items: "x" } },
      { entryId: 1, sortIndex: 5, content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelineTweet", tweet_results: { result: { legacy: "no" } } } } },
      { entryId: "x", content: { entryType: "TimelineTimelineModule", items: [null, 1, { item: null }, { item: { itemContent: 5 } }] } })),
    { errors: [{ message: "Rate limit exceeded", code: 88 }] },
  ];
  for (const x of bad) {
    assert.deepEqual(P.timeline(x), { posts: [], cursorTop: null, cursorBottom: null }, JSON.stringify(x));
    assert.deepEqual(P.detail(x), { items: [], moduleAdds: [], cursorBottom: null }, JSON.stringify(x));
    assert.equal(P.tweet(x), null, JSON.stringify(x));
  }
  assert.doesNotThrow(() => P.tweet({ __typename: "Tweet", rest_id: "1", legacy: { full_text: 5, entities: "x", extended_entities: 3, display_text_range: "no" }, core: { user_results: { result: { core: { screen_name: "a" } } } } }));
});

test("timeline(): instructions are found by depth-limited search when the usual path is gone", () => {
  // Bug prevented: X renaming home_timeline_urt and every response parsing to nothing.
  const entries = add(item("t", S(1), T.gif));
  assert.deepEqual(ids(P.timeline({ data: { home: { renamed_urt: { deeper: { instructions: [entries] } } } } }).posts), [ID(103)]);
  let deep = { instructions: [entries] };
  for (let i = 0; i < 7; i++) deep = { next: deep };
  assert.deepEqual(P.timeline({ data: deep }).posts, [], "too deep (> 6) must not be found");
});

// ---- detail ----------------------------------------------------------------

test("detail(): ancestors, focal post, reply modules and module additions", () => {
  // Bug prevented: thread entries mixed up, related/promoted posts leaking in, or module appends lost.
  const d = P.detail(DETAIL);
  assert.deepEqual(d.items.map((i) => [i.kind, i.entryId]), [
    ["post", `tweet-${ID(101)}`],
    ["post", `tweet-${ID(105)}`],
    ["module", `conversationthread-${ID(201)}`],
    ["module", `conversationthread-${ID(203)}`],
  ]);
  assert.equal(d.items[0].post.id, ID(101));
  assert.equal(d.items[1].post.id, ID(105));
  assert.deepEqual(ids(d.items[2].posts), [ID(201), ID(202)]);
  assert.deepEqual(ids(d.items[3].posts), [ID(203)]);
  assert.deepEqual(d.moduleAdds.map((m) => [m.entryId, ids(m.posts)]), [[`conversationthread-${ID(201)}`, [ID(204)]]]);
  assert.equal(d.cursorBottom, "FAKE_DETAIL_BOTTOM");
});

test("detail(): posts carry no sortIndex, and replies are flagged", () => {
  // Bug prevented: detail posts given a timeline sortIndex, which would confuse "newer than" logic.
  const d = P.detail(DETAIL);
  const all = [d.items[0].post, d.items[1].post, ...d.items[2].posts, ...d.items[3].posts, ...d.moduleAdds[0].posts];
  assert.ok(all.every((p) => p.sortIndex === null));
  assert.equal(d.items[2].posts[0].isReply, true);
  assert.equal(d.items[0].post.isReply, false);
});

test("detail(): a module with no readable posts is dropped and non-conversation modules are ignored", () => {
  // Bug prevented: empty reply groups (all tombstones) rendered as blank blocks; "related posts" shown as replies.
  const json = { data: { threaded_conversation_with_injections_v2: { instructions: [add(
    mod(`conversationthread-${ID(300)}`, S(3), [modItem("a", T.tombstone)]),
    mod("tweetdetailrelatedtweets-x", S(2), [modItem("b", T.gif)]),
  )] } } };
  assert.deepEqual(P.detail(json), { items: [], moduleAdds: [], cursorBottom: null });
});

test("detail(): instructions are found by fallback search too", () => {
  // Bug prevented: a renamed threaded_conversation key leaving every thread empty.
  const json = { data: { renamed_conversation: { instructions: [add(item(`tweet-${ID(103)}`, S(1), T.gif))] } } };
  assert.deepEqual(P.detail(json).items.map((i) => i.post.id), [ID(103)]);
});

// ---- image urls ------------------------------------------------------------

test("photoUrl(): pbs.twimg.com urls get format/name query params; everything else is unchanged", () => {
  // Bug prevented: requesting the tiny default size, or mangling data: URIs in the harness.
  const base = "https://pbs.twimg.com/media/FAKEm1";
  for (const size of ["small", "medium", "large", "orig"]) {
    assert.equal(P.photoUrl(`${base}.jpg`, size), `${base}?format=jpg&name=${size}`);
  }
  assert.equal(P.photoUrl(`${base}.PNG`, "large"), `${base}?format=png&name=large`);
  assert.equal(P.photoUrl("https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/FAKEposter.jpg", "small"), "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/FAKEposter?format=jpg&name=small");
  assert.equal(P.photoUrl(`${base}.jpg`, "bogus"), `${base}?format=jpg&name=medium`);
  const data = "data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E";
  assert.equal(P.photoUrl(data, "large"), data);
  for (const u of ["https://example.invalid/a.jpg", "https://pbs.twimg.com.evil.invalid/a.jpg", `${base}.jpg?name=small`, `${base}`]) {
    assert.equal(P.photoUrl(u, "large"), u);
  }
});

test("avatarUrl(): large swaps _normal for _bigger; other sizes and other urls are unchanged", () => {
  // Bug prevented: blurry 48px avatars in the drawer, or corrupting non-X avatar urls.
  const a = "https://pbs.twimg.com/profile_images/FAKEalice/avatar_normal.jpg";
  assert.equal(P.avatarUrl(a, "large"), "https://pbs.twimg.com/profile_images/FAKEalice/avatar_bigger.jpg");
  assert.equal(P.avatarUrl(a, "small"), a);
  assert.equal(P.avatarUrl(a), a);
  assert.equal(P.avatarUrl("data:image/png;base64,AAAA", "large"), "data:image/png;base64,AAAA");
});
