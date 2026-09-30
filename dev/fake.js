// Synthetic GraphQL for the dev harness, in the shapes src/parse.js reads.
// Everything here is invented: fake handles, fake text, SVG data-URI media.
// (CLAUDE.md invariant 8: never a captured real timeline.)
(() => {
  "use strict";
  const F = (window.XGFake = {});

  const BASE = 1900000000000000000n; // sortIndex origin; pages count down from here
  const byId = new Map(); // rest_id -> raw tweet, so navigate can build a thread for any post
  let idCounter = 0n;
  const nextId = () => String(1800000000000000000n + ++idCounter);

  // ---- utilities ---------------------------------------------------------------
  function mulberry32(a) {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hashStr = (s) => {
    let h = 2166136261;
    for (const c of String(s)) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const pick = (rng, a) => a[Math.floor(rng() * a.length)];
  const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const code = (rng) => {
    let s = "";
    for (let i = 0; i < 10; i++) s += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(rng() * 62)];
    return s;
  };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cps = (s) => Array.from(s).length;
  function shuffle(rng, a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function twDate(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
  }

  // ---- cast --------------------------------------------------------------------------
  // Both user shapes on purpose, and `following` true / false / absent.
  const CAST = [
    { id: "1001", handle: "alice", name: "Alice Example", following: true, shape: "new", verified: true },
    { id: "1002", handle: "bob", name: "Bob, whose display name is far too long to fit on one line", following: false, shape: "legacy" },
    { id: "1003", handle: "carol", name: "Carol", following: true, shape: "legacy" },
    { id: "1004", handle: "dave", name: "Dave Sample", following: false, shape: "new" },
    { id: "1005", handle: "erin", name: "Erin", following: true, shape: "new", verified: true },
    { id: "1006", handle: "frank", name: "Frank Fixture", following: false, shape: "legacy" },
    { id: "1007", handle: "grace", name: "Grace", following: true, shape: "new" },
    { id: "1008", handle: "heidi", name: "Heidi Test", following: false, shape: "legacy", verified: true },
    { id: "1009", handle: "ivan", name: "Ivan", following: true, shape: "legacy" },
    { id: "1010", handle: "judy", name: "Judy Mock", following: false, shape: "new" },
    { id: "1011", handle: "mallory", name: "Mallory (follow state unknown)", following: null, shape: "legacy" },
    { id: "1012", handle: "niaj", name: "Niaj", following: true, shape: "new" },
    { id: "1013", handle: "olivia", name: "Olivia Placeholder", following: false, shape: "new" },
    { id: "1014", handle: "peggy", name: "Peggy", following: true, shape: "legacy" },
    { id: "1015", handle: "trent", name: "Trent", following: false, shape: "legacy" },
    { id: "1016", handle: "victor", name: "Victor Vector", following: false, shape: "new" },
  ];
  const VIEWER = { id: "9000", handle: "you", name: "You (the viewer)", following: false, shape: "new" };
  F.cast = CAST.concat([VIEWER]);
  F.viewerId = VIEWER.id;
  const userById = (id) => F.cast.find((u) => u.id === id);

  function avatarUri(u) {
    const hue = hashStr(u.handle) % 360;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
      `<rect width="96" height="96" fill="hsl(${hue},45%,38%)"/>` +
      `<text x="48" y="50" fill="#fff" font-family="Arial" font-size="46" font-weight="700" text-anchor="middle" dominant-baseline="central">${u.handle[0].toUpperCase()}</text></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function userRaw(u) {
    if (u.shape === "new") {
      const r = {
        __typename: "User",
        rest_id: u.id,
        is_blue_verified: !!u.verified,
        core: { name: u.name, screen_name: u.handle },
        avatar: { image_url: avatarUri(u) },
        legacy: {},
      };
      if (u.following !== null) r.relationship_perspectives = { following: u.following };
      return r;
    }
    const legacy = { name: u.name, screen_name: u.handle, profile_image_url_https: avatarUri(u), verified: false };
    if (u.following !== null) legacy.following = u.following;
    return { __typename: "User", rest_id: u.id, is_blue_verified: !!u.verified, legacy };
  }

  // ---- media ---------------------------------------------------------------------------
  const RATIOS = [
    [1, 1, "1:1"], [4, 3, "4:3"], [3, 4, "3:4"], [16, 9, "16:9"], [9, 16, "9:16"], [3, 2, "3:2"],
    [2, 3, "2:3"], [21, 9, "21:9"], [1, 2, "1:2 (clamped)"], [5, 4, "5:4"], [4, 5, "4:5"], [2, 1, "2:1"],
  ];

  function imageUri(w, h, label, hue) {
    const sw = Math.max(2, Math.round(Math.min(w, h) / 90));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,44%)"/>` +
      `<stop offset="1" stop-color="hsl(${(hue + 45) % 360},60%,24%)"/></linearGradient></defs>` +
      `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      `<g fill="none" stroke="rgba(255,255,255,.26)" stroke-width="${sw}"><path d="M0 0L${w} ${h}M${w} 0L0 ${h}"/>` +
      `<rect x="${w * 0.05}" y="${h * 0.05}" width="${w * 0.9}" height="${h * 0.9}" rx="${Math.min(w, h) * 0.04}"/></g>` +
      `<text x="${w / 2}" y="${h / 2}" fill="#fff" font-family="Arial,sans-serif" font-size="${Math.round(Math.min(w, h) / 7)}" ` +
      `font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const fakeMp4 = (tag) => "data:video/mp4;base64," + btoa("fake-" + tag);

  function mediaEntity(kind, ratio, rng, tco, alt) {
    const [rw, rh, label] = ratio;
    const long = 720;
    const w = rw >= rh ? long : Math.round((long * rw) / rh);
    const h = rw >= rh ? Math.round((long * rh) / rw) : long;
    const m = {
      id_str: nextId(),
      type: kind === "gif" ? "animated_gif" : kind,
      media_url_https: imageUri(w, h, kind === "photo" ? label : label + " " + kind, Math.floor(rng() * 360)),
      url: tco,
      original_info: { width: w * 3, height: h * 3 },
      sizes: { large: { w: w * 2, h: h * 2 } },
    };
    if (alt) m.ext_alt_text = alt;
    if (kind === "video") {
      m.video_info = {
        aspect_ratio: [rw, rh],
        duration_millis: 4000 + Math.floor(rng() * 180000),
        variants: shuffle(rng, [
          { bitrate: 256000, content_type: "video/mp4", url: fakeMp4("256") },
          { bitrate: 832000, content_type: "video/mp4", url: fakeMp4("832") },
          { bitrate: 2176000, content_type: "video/mp4", url: fakeMp4("2176") },
          { content_type: "application/x-mpegURL", url: "https://video.example.invalid/pl/fake.m3u8" },
        ]),
      };
    } else if (kind === "gif") {
      m.video_info = {
        aspect_ratio: [rw, rh],
        duration_millis: 3000,
        variants: [{ bitrate: 0, content_type: "video/mp4", url: fakeMp4("gif") }],
      };
    }
    return m;
  }

  // ---- text pools --------------------------------------------------------------------------
  const BODIES = [
    "Trying out a new layout for the weekend project.",
    "Coffee first, then everything else.",
    "Notes from today: column balancing is mostly bookkeeping.",
    "Golden hour on the balcony.",
    "Shipping small changes every day beats one big rewrite.",
    "Fish & chips, then a long walk by the water.",
    "Does anyone else keep a folder called \"misc\" with 4,000 files in it?",
    "New desk setup finally done. Cable management was the real project.",
    "Reading the changelog so you don't have to.",
    "Quick reminder to drink some water and stretch.",
    "Sunday market haul: tomatoes, basil, one suspiciously large squash.",
    "Rain all day. Perfect excuse to finish the side quest.",
    "Hot take: the second draft is where the work actually happens.",
    "Three tabs open, zero regrets.",
  ];
  const LINKS = [
    "Wrote up some thoughts on #masonry layouts with @alice and @bob, details below.",
    "Long read for the weekend, worth it. cc @carol #reading",
    "Slides from the talk are up now. Thanks @dave & everyone who came! #meetup",
  ];
  const LONG =
    "Thread-length thoughts in a single post, because sometimes one idea needs room. " +
    "The first paragraph sets the scene: a small tool, a large pile of data, and a deadline that keeps moving. " +
    "The second explains the trade-off we kept circling back to, which was speed against clarity, and why we picked clarity. " +
    "The third is a list of things we would do differently next time, most of which involve writing the boring tests earlier. " +
    "Finally, a short note of thanks to everyone who reviewed drafts, found the awkward edge cases, and didn't complain about the naming.";
  const ALTS = ["A test pattern with diagonal lines", "Placeholder image, coloured rectangle", "Synthetic photo used by the harness"];

  // ---- tweets ----------------------------------------------------------------------------------
  function pickUser(rng) {
    return rng() < 0.04 ? VIEWER : pick(rng, CAST);
  }

  function pickCount(rng) {
    return pick(rng, [0, 0, 0, 2, 5, 12, 47, 180, 640, 1200, 1234, 5400, 23000, 120000, 3400000]);
  }

  // o: { author, body, link, media:[{kind, ratio, alt}], toUser, toId, quote, long, sensitive, ageMin, id }
  function buildTweet(o, rng) {
    const id = o.id || nextId();
    const urls = [];
    let text = esc(o.body || "");
    if (o.link) {
      const tco = "https://t.co/" + code(rng);
      text += " " + tco;
      urls.push({ url: tco, expanded_url: "https://example.com/notes/" + code(rng).toLowerCase(), display_url: "example.com/notes/" + code(rng).toLowerCase().slice(0, 6) + "…" });
    }
    const prefix = o.toUser ? "@" + o.toUser.handle + " " : "";
    let full = prefix + text;
    const displayEnd = cps(full);
    const legacy = {
      created_at: twDate(Date.now() - o.ageMin * 60000),
      id_str: id,
      display_text_range: [cps(prefix), displayEnd],
      entities: { urls, hashtags: [], user_mentions: [] },
      favorite_count: pickCount(rng),
      retweet_count: pickCount(rng),
      reply_count: pickCount(rng),
      quote_count: pickCount(rng) >> 3,
      bookmark_count: pickCount(rng) >> 2,
      favorited: rng() < 0.08,
      retweeted: rng() < 0.05,
      possibly_sensitive: !!o.sensitive,
      is_quote_status: !!o.quote,
    };
    if (o.toUser) {
      legacy.in_reply_to_status_id_str = o.toId || nextId();
      legacy.in_reply_to_user_id_str = o.toUser.id;
      legacy.in_reply_to_screen_name = o.toUser.handle;
    }
    if (o.media && o.media.length) {
      const tco = "https://t.co/" + code(rng);
      full += " " + tco;
      const ents = o.media.map((m) => mediaEntity(m.kind, m.ratio, rng, tco, m.alt));
      legacy.entities.media = [ents[0]];
      legacy.extended_entities = { media: ents };
    }
    const raw = {
      __typename: "Tweet",
      rest_id: id,
      core: { user_results: { result: userRaw(o.author) } },
      legacy,
    };
    if (rng() < 0.92) raw.views = { count: String(Math.max(legacy.favorite_count * between(rng, 12, 60), 1)), state: "EnabledWithCount" };
    if (o.quote) {
      const qurl = "https://t.co/" + code(rng);
      full += " " + qurl;
      legacy.quoted_status_permalink = { url: qurl, expanded: "https://x.com/i/web/status/" + o.quote.rest_id, display: "x.com/i/web/status/…" };
      raw.quoted_status_result = { result: o.quote };
    }
    if (o.long) {
      raw.note_tweet = { note_tweet_results: { result: { text: LONG, entity_set: { urls: [], hashtags: [], user_mentions: [] } } } };
      full = LONG.slice(0, 250) + "… https://t.co/" + code(rng);
      legacy.display_text_range = [0, 250];
    }
    legacy.full_text = full;
    byId.set(id, raw);
    return raw;
  }

  function buildRepost(author, original, ageMin, rng) {
    const id = nextId();
    return {
      __typename: "Tweet",
      rest_id: id,
      core: { user_results: { result: userRaw(author) } },
      legacy: {
        created_at: twDate(Date.now() - ageMin * 60000),
        id_str: id,
        full_text: "RT @" + userById(original.core.user_results.result.rest_id).handle + ": …",
        retweeted_status_result: { result: original },
        entities: { urls: [] },
      },
    };
  }

  // One in eight is delivered wrapped, like X does for visibility-filtered posts.
  const wrap = (raw) => (hashStr(raw.rest_id) % 8 === 0 ? { __typename: "TweetWithVisibilityResults", tweet: raw } : raw);

  const itemEntry = (raw, sortIndex, prefix = "tweet") => ({
    entryId: `${prefix}-${raw.rest_id}`,
    sortIndex,
    content: {
      entryType: "TimelineTimelineItem",
      __typename: "TimelineTimelineItem",
      itemContent: { itemType: "TimelineTweet", __typename: "TimelineTweet", tweet_results: { result: wrap(raw) }, tweetDisplayType: "Tweet" },
    },
  });

  const moduleItems = (id, raws) =>
    raws.map((r) => ({
      entryId: `conversationthread-${id}-tweet-${r.rest_id}`,
      item: { itemContent: { itemType: "TimelineTweet", __typename: "TimelineTweet", tweet_results: { result: wrap(r) } } },
    }));

  const moduleEntry = (entryId, id, raws, sortIndex) => ({
    entryId,
    sortIndex,
    content: {
      entryType: "TimelineTimelineModule",
      __typename: "TimelineTimelineModule",
      displayType: "VerticalConversation",
      items: moduleItems(id, raws),
    },
  });

  const cursorEntry = (type, value, sortIndex) => ({
    entryId: `cursor-${type.toLowerCase()}-${value}`,
    sortIndex,
    content: { entryType: "TimelineTimelineCursor", __typename: "TimelineTimelineCursor", cursorType: type, value },
  });

  // ---- home timeline -----------------------------------------------------------------------------
  const KINDS = [
    "photo", "photo", "photo2", "text", "video", "photo", "gif", "photo3", "quote", "repost",
    "photo", "reply", "selfreply", "photo4", "link", "photo", "module", "photo", "sensitive", "longtext",
  ];
  F.recent = []; // raw tweets from the latest home pages, for the fake X page underneath

  function photoMedia(rng, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ kind: "photo", ratio: pick(rng, RATIOS), alt: rng() < 0.3 ? pick(rng, ALTS) : null });
    return out;
  }

  function homeEntry(kind, rng, sortIndex) {
    const age = () => {
      const r = rng();
      if (r < 0.1) return between(rng, 60 * 24 * 400, 60 * 24 * 700); // another year
      if (r < 0.3) return between(rng, 60 * 24 * 2, 60 * 24 * 60); // days to weeks
      return between(rng, 0, 60 * 23); // minutes to hours
    };
    const author = pickUser(rng);
    const base = { author, body: pick(rng, BODIES), ageMin: age() };
    let raw;
    let entry;
    switch (kind) {
      case "photo": raw = buildTweet({ ...base, media: photoMedia(rng, 1) }, rng); break;
      case "photo2": raw = buildTweet({ ...base, media: photoMedia(rng, 2) }, rng); break;
      case "photo3": raw = buildTweet({ ...base, media: photoMedia(rng, 3) }, rng); break;
      case "photo4": raw = buildTweet({ ...base, media: photoMedia(rng, 4) }, rng); break;
      case "video": raw = buildTweet({ ...base, media: [{ kind: "video", ratio: pick(rng, [[16, 9, "16:9"], [9, 16, "9:16"], [1, 1, "1:1"]]) }] }, rng); break;
      case "gif": raw = buildTweet({ ...base, media: [{ kind: "gif", ratio: pick(rng, [[1, 1, "1:1"], [4, 3, "4:3"], [16, 9, "16:9"]]) }] }, rng); break;
      case "sensitive": raw = buildTweet({ ...base, body: "A photo the harness marks as sensitive.", media: photoMedia(rng, 1), sensitive: true }, rng); break;
      case "text": raw = buildTweet(base, rng); break;
      case "link": raw = buildTweet({ ...base, body: pick(rng, LINKS), link: rng() < 0.7 }, rng); break;
      case "longtext": raw = buildTweet({ ...base, long: true }, rng); break;
      case "quote": {
        const qa = pickUser(rng);
        const inner = buildTweet({ author: pickUser(rng), body: "A quote of a quote, which the parser drops.", ageMin: 600 }, rng);
        const quoted = buildTweet({ author: qa, body: pick(rng, BODIES), ageMin: age(), media: rng() < 0.6 ? photoMedia(rng, 1) : [], quote: rng() < 0.4 ? inner : null }, rng);
        raw = buildTweet({ ...base, body: "Worth reading this one.", quote: quoted }, rng);
        break;
      }
      case "repost": {
        const orig = buildTweet({ author: pickUser(rng), body: pick(rng, BODIES), ageMin: age(), media: rng() < 0.65 ? photoMedia(rng, 1) : [] }, rng);
        raw = orig;
        const outer = buildRepost(pick(rng, CAST.filter((u) => u.following)), orig, between(rng, 1, 300), rng);
        entry = itemEntry(outer, sortIndex);
        break;
      }
      case "reply": {
        const to = pick(rng, CAST.filter((u) => u.id !== author.id));
        raw = buildTweet({ ...base, body: "Replying with a photo.", toUser: to, media: rng() < 0.5 ? photoMedia(rng, 1) : [] }, rng);
        break;
      }
      case "selfreply": {
        raw = buildTweet({ ...base, body: "(2/2) And that's the rest of the thought.", toUser: author, media: rng() < 0.4 ? photoMedia(rng, 1) : [] }, rng);
        break;
      }
      case "module": {
        const a = pickUser(rng);
        const first = buildTweet({ author: a, body: "Conversation opener, in a module.", ageMin: 200, media: photoMedia(rng, 1) }, rng);
        const second = buildTweet({ author: pickUser(rng), body: "Reply inside the module.", toUser: a, toId: first.rest_id, ageMin: 150 }, rng);
        const third = buildTweet({ author: a, body: "And a follow-up from the opener.", toUser: a, toId: second.rest_id, ageMin: 100, media: rng() < 0.5 ? photoMedia(rng, 2) : [] }, rng);
        const mid = first.rest_id;
        F.recent.push(second, third);
        entry = moduleEntry(`home-conversation-${mid}`, mid, [first, second, third], sortIndex);
        raw = first;
        break;
      }
      default: raw = buildTweet(base, rng);
    }
    F.recent.push(raw);
    return entry || itemEntry(raw, sortIndex);
  }

  function promotedEntry(rng, sortIndex) {
    const raw = buildTweet({ author: pick(rng, CAST), body: "Sponsored: an ad the parser must skip.", media: photoMedia(rng, 1), ageMin: 30 }, rng);
    const e = itemEntry(raw, sortIndex, "promoted-tweet");
    e.content.itemContent.promotedMetadata = { advertiser_results: {} };
    return e;
  }

  const homeJson = (entries, extra = []) => ({
    data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineClearCache" }, { type: "TimelineAddEntries", entries }, ...extra] } } },
  });

  // 20 entries + one promoted + cursors. Page 1 keeps a fixed order so the first
  // screenful is predictable; later pages shuffle.
  F.homePage = (op, pageNo) => {
    F.recent.length = pageNo === 1 ? 0 : F.recent.length;
    const rng = mulberry32(hashStr(op) + pageNo * 7919);
    const kinds = pageNo === 1 ? KINDS : shuffle(rng, KINDS);
    const si = (i) => String(BASE - BigInt((pageNo - 1) * 100 + i));
    const entries = [];
    kinds.forEach((k, i) => {
      entries.push(homeEntry(k, rng, si(i + 1)));
      if (i === 5) entries.push(promotedEntry(rng, si(50)));
    });
    if (pageNo === 1) entries.push(cursorEntry("Top", "top-" + op + "-1", String(BASE + 1000n)));
    entries.push(cursorEntry("Bottom", `bottom-${op}-${pageNo}`, si(99)));
    if (F.recent.length > 40) F.recent.splice(0, F.recent.length - 40);
    return homeJson(entries);
  };

  // A page of posts newer than everything loaded, so the store parks them as "pending".
  let newerCount = 0;
  F.newerPage = (op) => {
    newerCount++;
    const rng = mulberry32(hashStr(op) + 555 + newerCount);
    const entries = [];
    for (let i = 0; i < 3; i++) {
      entries.push(homeEntry(pick(rng, ["photo", "photo2", "text", "video", "quote"]), rng, String(BASE + 2000n + BigInt(newerCount * 10 + i))));
    }
    entries.push(cursorEntry("Top", `top-newer-${newerCount}`, String(BASE + 3000n + BigInt(newerCount))));
    return homeJson(entries);
  };

  // ---- threads --------------------------------------------------------------------------------------
  const threads = new Map();

  function replyRaw(rng, to, toRaw, ageMin) {
    const author = pick(rng, F.cast);
    const toUser = userById(toRaw.core.user_results.result.rest_id) || to;
    return buildTweet(
      {
        author,
        body: pick(rng, ["Great point.", "Not sure I agree, but interesting.", "Same here!", "Saving this for later.", "Ha, this made my morning.", "Could you share the source?", "+1 to this."]),
        toUser,
        toId: toRaw.rest_id,
        ageMin,
        media: rng() < 0.12 ? photoMedia(rng, 1) : [],
        link: rng() < 0.08,
      },
      rng
    );
  }

  F.thread = (id) => {
    if (threads.has(id)) return threads.get(id);
    const rng = mulberry32(hashStr(id));
    let focal = byId.get(id);
    if (!focal) focal = buildTweet({ id, author: pickUser(rng), body: "A post opened directly by id.", ageMin: 90 }, rng);
    // Ancestors: follow in_reply_to links, inventing parents as needed.
    const ancestors = [];
    let cur = focal;
    for (let depth = 0; depth < 2; depth++) {
      const pid = cur.legacy.in_reply_to_status_id_str;
      if (!pid) break;
      let parent = byId.get(pid);
      if (!parent) {
        const pu = userById(cur.legacy.in_reply_to_user_id_str) || pick(rng, CAST);
        parent = buildTweet(
          { id: pid, author: pu, body: pick(rng, BODIES), ageMin: 60 * 30, media: rng() < 0.4 ? photoMedia(rng, 1) : [], toUser: depth === 0 && rng() < 0.4 ? pick(rng, CAST) : null },
          rng
        );
      }
      ancestors.unshift(parent);
      cur = parent;
    }
    const focalAge = 60;
    const modules = [];
    for (let m = 0; m < 6; m++) {
      const head = replyRaw(rng, null, focal, between(rng, 1, focalAge));
      const raws = [head];
      const extra = between(rng, 0, 2);
      for (let k = 0; k < extra; k++) raws.push(replyRaw(rng, null, raws[raws.length - 1], between(rng, 0, 30)));
      modules.push({ entryId: `conversationthread-${head.rest_id}`, id: head.rest_id, raws });
    }
    const more = [replyRaw(rng, null, modules[0].raws[0], 5), replyRaw(rng, null, modules[0].raws[0], 3)];
    const t = { focal, ancestors, modules, more, stage: 0 };
    threads.set(id, t);
    return t;
  };

  // stage 0: ancestors, focal, three reply modules, a cursor.
  // stage 1: two more modules, two more replies inside the first module, a cursor.
  // stage 2: the last module, no cursor: the end of the thread.
  F.detail = (id, stage) => {
    const t = F.thread(id);
    const entries = [];
    const extra = [];
    let n = 0;
    const si = () => String(BASE - BigInt(stage * 100 + n++));
    if (stage === 0) {
      t.ancestors.forEach((a) => entries.push(itemEntry(a, si())));
      entries.push(itemEntry(t.focal, si()));
      t.modules.slice(0, 3).forEach((m) => entries.push(moduleEntry(m.entryId, m.id, m.raws, si())));
      entries.push(cursorEntry("Bottom", `detail-${id}-1`, si()));
    } else if (stage === 1) {
      t.modules.slice(3, 5).forEach((m) => entries.push(moduleEntry(m.entryId, m.id, m.raws, si())));
      entries.push(cursorEntry("Bottom", `detail-${id}-2`, si()));
      extra.push({ type: "TimelineAddToModule", moduleEntryId: t.modules[0].entryId, moduleItems: moduleItems(t.modules[0].id, t.more) });
    } else {
      t.modules.slice(5).forEach((m) => entries.push(moduleEntry(m.entryId, m.id, m.raws, si())));
    }
    return { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: "TimelineAddEntries", entries }, ...extra] } } };
  };

  // Every raw tweet a thread page would show, in reading order (for the fake X DOM).
  F.threadRaws = (id) => {
    const t = F.thread(id);
    const out = [...t.ancestors, t.focal];
    t.modules.forEach((m) => out.push(...m.raws));
    out.push(...t.more);
    return out;
  };
  F.raw = (id) => byId.get(id) || null;
})();
