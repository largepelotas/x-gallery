// XG.parse: X GraphQL JSON -> normalized Post (contract: DESIGN.md).
// Pure: no DOM, no chrome.*, no timers. Every response-shape assumption in the
// extension lives here. It never throws on an unexpected shape (invariant 5):
// an entry it cannot read is skipped, the rest of the batch survives.
(() => {
  const XG = (globalThis.XG ??= {});

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === "string" ? v : "");
  const count = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const pos = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  const PROMOTED = /^promoted-/;

  // ---- users ---------------------------------------------------------------

  let warnedUser = false;
  function warnUserOnce() {
    if (warnedUser) return;
    warnedUser = true;
    try {
      console.warn("[X Gallery] a user has neither relationship_perspectives.following nor legacy.following; the 'Following only' filter will let them through");
    } catch {}
  }

  // `res` is core.user_results.result. Newer shape first, legacy fields as fallback.
  function parseUser(res) {
    if (!isObj(res)) return null;
    const core = isObj(res.core) ? res.core : {};
    const leg = isObj(res.legacy) ? res.legacy : {};
    const rp = isObj(res.relationship_perspectives) ? res.relationship_perspectives : {};
    const handle = str(core.screen_name) || str(leg.screen_name);
    if (!/^\w+$/.test(handle)) return null; // handles go into site-relative hrefs
    let following = null;
    if (typeof rp.following === "boolean") following = rp.following;
    else if (typeof leg.following === "boolean") following = leg.following;
    else warnUserOnce();
    return {
      id: str(res.rest_id),
      name: str(core.name) || str(leg.name) || handle,
      handle,
      avatar: str(isObj(res.avatar) ? res.avatar.image_url : "") || str(leg.profile_image_url_https),
      verified: (isObj(res.verification) && res.verification.verified === true) || res.is_blue_verified === true || leg.verified === true,
      following,
    };
  }

  // ---- text ----------------------------------------------------------------

  const ENTITY = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  // One pass, so "&amp;lt;" decodes to "&lt;" and not to "<".
  const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITY[m]);
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The lookbehind keeps "bob@example.com" and "abc#def" from becoming mentions/hashtags.
  const TOKEN = /(?<![\p{L}\p{N}_])(?:@(\w{1,15})|#([\p{L}\p{N}_]+))/gu;
  const httpUrl = (u) => (/^https?:\/\//i.test(u) ? u : "");

  function segmentText(text, urls) {
    const out = [];
    const plain = (s) => {
      let last = 0;
      for (const m of s.matchAll(TOKEN)) {
        if (m.index > last) out.push({ type: "text", text: s.slice(last, m.index) });
        if (m[1] !== undefined) out.push({ type: "mention", text: "@" + m[1], href: "/" + m[1] });
        else out.push({ type: "hashtag", text: "#" + m[2], href: "/hashtag/" + m[2] });
        last = m.index + m[0].length;
      }
      if (last < s.length) out.push({ type: "text", text: s.slice(last) });
    };
    const byUrl = new Map();
    for (const u of urls) if (isObj(u) && str(u.url)) byUrl.set(u.url, u);
    if (!byUrl.size) {
      plain(text);
      return out;
    }
    // Longest first, so a t.co that prefixes another cannot shadow it.
    const re = new RegExp([...byUrl.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "g");
    let last = 0;
    for (const m of text.matchAll(re)) {
      plain(text.slice(last, m.index));
      const u = byUrl.get(m[0]);
      const href = httpUrl(str(u.expanded_url)) || httpUrl(m[0]);
      const label = str(u.display_url) || str(u.expanded_url) || m[0];
      if (href) out.push({ type: "link", text: label, href });
      else plain(label);
      last = m.index + m[0].length;
    }
    plain(text.slice(last));
    return out;
  }

  function buildSegments(r, legacy, hasQuote) {
    const note = r.note_tweet?.note_tweet_results?.result;
    const useNote = isObj(note) && str(note.text) !== "";
    let text = useNote ? note.text : str(legacy.full_text);
    const ents = isObj(legacy.entities) ? legacy.entities : {};
    const urls = arr(ents.urls).concat(useNote ? arr(note.entity_set?.urls) : []);

    // Step 2: drop auto-inserted reply mentions. Code points, not UTF-16 units.
    const start = arr(legacy.display_text_range)[0];
    if (Number.isInteger(start) && start > 0) text = Array.from(text).slice(start).join("");

    // Step 3: the t.co links to our own media and quote card are not text.
    const drop = arr(ents.media).concat(arr(legacy.extended_entities?.media)).map((m) => str(isObj(m) ? m.url : ""));
    if (hasQuote) drop.push(str(legacy.quoted_status_permalink?.url));
    for (const u of drop) if (u) text = text.split(u).join("");

    return segmentText(decode(text.trim()), urls);
  }

  // ---- media / counts ------------------------------------------------------

  const MEDIA_TYPES = new Map([["photo", "photo"], ["video", "video"], ["animated_gif", "gif"]]);

  function parseMedia(legacy) {
    const ext = arr(legacy.extended_entities?.media);
    const out = [];
    for (const m of ext.length ? ext : arr(legacy.entities?.media)) {
      if (!isObj(m)) continue;
      const type = MEDIA_TYPES.get(m.type);
      const src = str(m.media_url_https);
      if (!type || !src) continue;
      let w = m.original_info?.width;
      let h = m.original_info?.height;
      if (!pos(w) || !pos(h)) [w, h] = [m.sizes?.large?.w, m.sizes?.large?.h];
      if (!pos(w) || !pos(h)) [w, h] = [1, 1];
      const vi = isObj(m.video_info) ? m.video_info : {};
      out.push({
        type,
        src,
        w,
        h,
        alt: typeof m.ext_alt_text === "string" && m.ext_alt_text ? m.ext_alt_text : null,
        durationMs: type !== "photo" && Number.isFinite(vi.duration_millis) ? vi.duration_millis : null,
        variants:
          type === "photo"
            ? []
            : arr(vi.variants)
                .filter((v) => isObj(v) && v.content_type === "video/mp4" && str(v.url))
                .map((v) => ({ url: v.url, bitrate: count(v.bitrate) }))
                .sort((a, b) => a.bitrate - b.bitrate),
      });
    }
    return out;
  }

  function parseViews(v) {
    const c = isObj(v) ? v.count : null;
    if (c === null || c === undefined || c === "") return null;
    const n = Number(c);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // ---- one tweet -----------------------------------------------------------

  function unwrap(input) {
    let r = input;
    if (isObj(r) && r.__typename === "TweetWithVisibilityResults") r = r.tweet;
    if (!isObj(r)) return null;
    if (r.__typename === "TweetTombstone" || r.__typename === "TweetUnavailable") return null;
    return isObj(r.legacy) ? r : null;
  }

  function safeParse(result, allowQuote) {
    try {
      return parseTweet(result, allowQuote);
    } catch {
      return null;
    }
  }

  function parseTweet(input, allowQuote) {
    const r = unwrap(input);
    if (!r) return null;
    const legacy = r.legacy;
    const author = parseUser(r.core?.user_results?.result);
    if (!author) return null;

    // A repost displays the original; the outer author becomes repostedBy.
    if (isObj(legacy.retweeted_status_result)) {
      const orig = safeParse(legacy.retweeted_status_result.result, allowQuote);
      if (!orig) return null;
      orig.repostedBy = { id: author.id, name: author.name, handle: author.handle, following: author.following };
      return orig;
    }

    const id = str(r.rest_id) || str(legacy.id_str);
    if (!/^\d+$/.test(id)) return null;
    const quote = allowQuote ? safeParse(r.quoted_status_result?.result, false) : null;
    const segments = buildSegments(r, legacy, quote !== null);
    const path = `/${author.handle}/status/${id}`;
    const isReply = str(legacy.in_reply_to_status_id_str) !== "" && str(legacy.in_reply_to_user_id_str) !== author.id;
    const created = Date.parse(str(legacy.created_at));

    return {
      id,
      url: "https://x.com" + path,
      path,
      author,
      createdAt: Number.isFinite(created) ? created : 0,
      segments,
      text: segments.map((s) => s.text).join(""),
      media: parseMedia(legacy),
      metrics: {
        replies: count(legacy.reply_count),
        reposts: count(legacy.retweet_count),
        likes: count(legacy.favorite_count),
        quotes: count(legacy.quote_count),
        bookmarks: count(legacy.bookmark_count),
        views: parseViews(r.views),
      },
      liked: legacy.favorited === true,
      reposted: legacy.retweeted === true,
      isReply,
      replyToHandle: isReply ? str(legacy.in_reply_to_screen_name) || null : null,
      repostedBy: null,
      quote,
      sensitive: legacy.possibly_sensitive === true,
      sortIndex: null,
    };
  }

  // ---- timeline structure --------------------------------------------------

  function search(node, depth) {
    if (!isObj(node) || depth > 6) return null;
    if (Array.isArray(node.instructions)) return node.instructions;
    for (const k of Object.keys(node)) {
      const found = search(node[k], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function findInstructions(json, primary) {
    let v = null;
    try {
      v = primary(json);
    } catch {}
    return Array.isArray(v) ? v : search(isObj(json) ? json.data : null, 0) || [];
  }

  function cursorOf(content) {
    const ic = isObj(content.itemContent) ? content.itemContent : {};
    const type = content.cursorType ?? ic.cursorType;
    const value = content.value ?? ic.value;
    return typeof type === "string" && typeof value === "string" ? { type, value } : null;
  }

  function tweetOfItem(ic) {
    if (!isObj(ic)) return null;
    if (ic.itemType !== "TimelineTweet" && ic.__typename !== "TimelineTweet") return null;
    if (ic.promotedMetadata !== undefined && ic.promotedMetadata !== null) return null;
    return safeParse(ic.tweet_results?.result, true);
  }

  // Module items and TimelineAddToModule.moduleItems share one shape.
  function moduleItemPosts(items) {
    const out = [];
    for (const it of arr(items)) {
      try {
        if (!isObj(it) || PROMOTED.test(str(it.entryId))) continue;
        const p = tweetOfItem(isObj(it.item) ? it.item.itemContent : null);
        if (p) out.push(p);
      } catch {}
    }
    return out;
  }

  // Walks every instruction type we understand; each entry is isolated so one
  // bad entry cannot take down the batch.
  function walk(instructions, onEntry, onModuleAdd) {
    const each = (fn, ...args) => {
      try {
        fn(...args);
      } catch {}
    };
    for (const ins of arr(instructions)) {
      if (!isObj(ins)) continue;
      if (ins.type === "TimelineAddEntries") for (const e of arr(ins.entries)) each(onEntry, e);
      else if (ins.type === "TimelinePinEntry" || ins.type === "TimelineReplaceEntry") each(onEntry, ins.entry);
      else if (ins.type === "TimelineAddToModule") each(onModuleAdd, str(ins.moduleEntryId), ins.moduleItems);
    }
  }

  // Classifies one entry for both parsers.
  function classify(entry) {
    if (!isObj(entry) || !isObj(entry.content)) return null;
    const content = entry.content;
    const entryId = str(entry.entryId);
    const cursor = cursorOf(content);
    if (cursor) return { kind: "cursor", entryId, cursor };
    if (PROMOTED.test(entryId)) return null;
    const type = content.entryType ?? content.__typename;
    if (type === "TimelineTimelineItem") {
      const post = tweetOfItem(content.itemContent);
      return post ? { kind: "post", entryId, post, sortIndex: str(entry.sortIndex) || null } : null;
    }
    if (type === "TimelineTimelineModule") {
      return { kind: "module", entryId, posts: moduleItemPosts(content.items), sortIndex: str(entry.sortIndex) || null };
    }
    return null;
  }

  function timeline(json) {
    const out = { posts: [], cursorTop: null, cursorBottom: null };
    try {
      const seen = new Set();
      const add = (p, sortIndex) => {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        p.sortIndex = sortIndex;
        out.posts.push(p);
      };
      const instructions = findInstructions(json, (j) => j.data.home.home_timeline_urt.instructions);
      walk(
        instructions,
        (entry) => {
          const c = classify(entry);
          if (!c) return;
          if (c.kind === "cursor") {
            if (c.cursor.type === "Top") out.cursorTop = c.cursor.value;
            else if (c.cursor.type === "Bottom") out.cursorBottom = c.cursor.value;
          } else if (c.kind === "post") add(c.post, c.sortIndex);
          else for (const p of c.posts) add(p, c.sortIndex);
        },
        (moduleId, items) => {
          for (const p of moduleItemPosts(items)) add(p, null);
        }
      );
    } catch {}
    return out;
  }

  function detail(json) {
    const out = { items: [], moduleAdds: [], cursorBottom: null };
    try {
      const instructions = findInstructions(json, (j) => j.data.threaded_conversation_with_injections_v2.instructions);
      walk(
        instructions,
        (entry) => {
          const c = classify(entry);
          if (!c) return;
          if (c.kind === "cursor") {
            if (c.cursor.type === "Bottom") out.cursorBottom = c.cursor.value;
          } else if (c.kind === "post") out.items.push({ kind: "post", entryId: c.entryId, post: c.post });
          else if (c.entryId.startsWith("conversationthread-") && c.posts.length) {
            out.items.push({ kind: "module", entryId: c.entryId, posts: c.posts });
          }
        },
        (moduleId, items) => {
          const posts = moduleItemPosts(items);
          if (moduleId && posts.length) out.moduleAdds.push({ entryId: moduleId, posts });
        }
      );
    } catch {}
    return out;
  }

  // ---- image urls ----------------------------------------------------------

  const SIZES = new Set(["small", "medium", "large", "orig"]);

  // pbs.twimg.com/.../ABC.jpg -> .../ABC?format=jpg&name=<size>. Anything else
  // (the harness uses data URIs) comes back unchanged.
  function photoUrl(src, size) {
    if (typeof src !== "string") return src;
    const m = /^(https?:\/\/pbs\.twimg\.com\/[^?#]+)\.([A-Za-z0-9]+)$/.exec(src);
    if (!m) return src;
    return `${m[1]}?format=${m[2].toLowerCase()}&name=${SIZES.has(size) ? size : "medium"}`;
  }

  function avatarUrl(src, size) {
    return typeof src === "string" && size === "large" ? src.replace("_normal.", "_bigger.") : src;
  }

  XG.parse = { timeline, detail, tweet: (result) => safeParse(result, true), photoUrl, avatarUrl };
  if (typeof module !== "undefined") module.exports = XG.parse;
})();
