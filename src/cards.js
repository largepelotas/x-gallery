// Renders a Post: the compact grid card, the drawer's thread posts (compact and
// focal), and post text. Everything untrusted goes in through textContent or
// property assignment. Only our own icon strings use innerHTML (via XG.icons).
(() => {
  const XG = (globalThis.XG ??= {});

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const icon = (name, cls) => XG.icons.el(name, cls);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---- formatting ----------------------------------------------------------

  // 999, 1.2K, 12K, 1.2M. Truncates rather than rounds, so we never print 1000K.
  function fmtCount(n) {
    n = Number(n);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n < 1000) return String(Math.floor(n));
    if (n < 1e4) return Math.floor(n / 100) / 10 + "K";
    if (n < 1e6) return Math.floor(n / 1000) + "K";
    if (n < 1e7) return Math.floor(n / 1e5) / 10 + "M";
    if (n < 1e9) return Math.floor(n / 1e6) + "M";
    return Math.floor(n / 1e8) / 10 + "B";
  }

  // now, 5m, 3h, Apr 3, and Apr 3, 2024 for other years.
  function fmtTime(ms, now = Date.now()) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    const s = Math.floor((now - ms) / 1000);
    if (s < 60) return "now"; // also covers small clock skew (future timestamps)
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    const base = MONTHS[d.getMonth()] + " " + d.getDate();
    return d.getFullYear() === new Date(now).getFullYear() ? base : base + ", " + d.getFullYear();
  }

  // 3:04 PM · Apr 3, 2025
  function fmtFull(ms) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    const h = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"} · ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  function fmtDuration(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // ---- safety ---------------------------------------------------------------

  // http(s) or a site-relative path. Anything else, including protocol-relative
  // "//host" and control-character tricks, is dropped.
  function safeHref(h) {
    if (typeof h !== "string") return null;
    const s = h.trim();
    if (/^https?:\/\/[^\s\u0000-\u001f]+$/i.test(s)) return s;
    if (/^\/(?![\/\\])[^\s\\\u0000-\u001f]*$/.test(s)) return s;
    return null;
  }

  function openTab(post) {
    const h = safeHref(post && post.url);
    if (h) window.open(h, "_blank", "noopener");
  }

  // ---- text -------------------------------------------------------------------

  // Appends segments to `parent`. `links: true` gives real anchors (drawer);
  // otherwise spans, because the whole grid card is the click target.
  function renderSegments(parent, segments, { links = false } = {}) {
    for (const s of segments || []) {
      if (!s || s.type === "text") {
        parent.appendChild(document.createTextNode((s && s.text) || ""));
        continue;
      }
      const href = links ? safeHref(s.href) : null;
      if (href) {
        const a = el("a", "xg-a", s.text);
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
        a.addEventListener("click", (e) => e.stopPropagation());
        parent.appendChild(a);
      } else {
        parent.appendChild(el("span", "xg-a", s.text));
      }
    }
  }

  // ---- shared pieces ------------------------------------------------------------

  const state = new WeakMap(); // element -> { kind, post, refs, opts }

  function avatar(author, cls, large) {
    const img = el("img", "xg-av" + (cls ? " " + cls : ""));
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    if (author && author.avatar) {
      img.src = large ? XG.parse.avatarUrl(author.avatar, "large") : author.avatar;
    }
    return img;
  }

  function nameBits(author) {
    const name = el("span", "xg-name", author.name || author.handle || "");
    const bits = [name];
    if (author.verified) {
      const v = icon("verified", "xg-vbadge");
      v.title = "Verified";
      bits.push(v);
    }
    return bits;
  }

  function metaRow(post, { withAvatar = true } = {}) {
    const row = el("div", "xg-meta");
    if (withAvatar) row.appendChild(avatar(post.author));
    row.append(...nameBits(post.author));
    row.appendChild(el("span", "xg-handle", "@" + post.author.handle));
    const t = el("span", "xg-time", "· " + fmtTime(post.createdAt));
    t.title = fmtFull(post.createdAt);
    row.appendChild(t);
    if (post.isReply) {
      const g = icon("replyArrow", "xg-replyglyph");
      g.title = post.replyToHandle ? "Replying to @" + post.replyToHandle : "Reply";
      row.appendChild(g);
    }
    return row;
  }

  // ---- video autoplay -------------------------------------------------------------
  // One IntersectionObserver drives every video (grid, compact thread posts, drawer
  // focal): play while at least a quarter is on screen, pause when it leaves.
  // The grid keeps its cards cached and detaches them when a filter hides them, so a
  // detached video is dropped here (the observer never holds a dead node) and
  // watchVideos() re-arms it when masonry places its card again.
  const watched = new Set();
  let videoIO = null;

  // A paused grid video still holds one of Chromium's ~75 media players per tab,
  // and X's own videos share that budget. So a video off screen gives its source
  // back (the poster stays up) and takes it again on the way in.
  function releaseVideo(v) {
    v.pause();
    const src = v.getAttribute("src");
    if (src) {
      v.dataset.src = src;
      v.removeAttribute("src");
      v.load(); // drops the media player
    }
  }

  function playVideo(v) {
    try {
      if (!v.getAttribute("src") && v.dataset.src) v.src = v.dataset.src;
      const p = v.play();
      if (p && p.catch) p.catch(() => {}); // autoplay refused: the poster stays up
    } catch {}
  }

  function unwatchVideo(v) {
    releaseVideo(v);
    watched.delete(v);
    if (videoIO) videoIO.unobserve(v);
  }

  function videoObserver() {
    if (!videoIO) {
      videoIO = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const v = e.target;
            if (!v.isConnected) unwatchVideo(v);
            else if (e.isIntersecting) playVideo(v);
            else releaseVideo(v);
          }
        },
        { threshold: 0.25 }
      );
    }
    return videoIO;
  }

  function watchVideo(v) {
    watched.add(v);
    videoObserver().observe(v);
  }

  // (Re)observe every video inside these elements. Idempotent.
  function watchVideos(els) {
    for (const e of els || []) {
      if (e && e.querySelectorAll) for (const v of e.querySelectorAll("video")) watchVideo(v);
    }
  }

  // Drop every watched video that has left the document.
  function sweepVideos() {
    for (const v of watched) if (!v.isConnected) unwatchVideo(v);
  }

  // Every video we render is silent, looping and inline; the observer starts it.
  function silentLoop(v) {
    v.muted = true;
    v.defaultMuted = true; // reflects the `muted` attribute too
    v.loop = true;
    v.playsInline = true;
  }

  const GRID_MIN_BITRATE = 800000;

  // Grid and compact-post source: the lowest mp4 variant at or above 800 kbps
  // (sharp enough for a column, cheap enough to run many at once), else the highest
  // available. Order-independent. A GIF's single variant falls out of the same rule.
  function gridVariant(m) {
    let lo = null;
    let hi = null;
    for (const x of m.variants || []) {
      if (!x || !x.url) continue;
      const b = Number(x.bitrate) || 0;
      if (!hi || b > hi.b) hi = { b, url: x.url };
      if (b >= GRID_MIN_BITRATE && (!lo || b < lo.b)) lo = { b, url: x.url };
    }
    const pick = lo || hi;
    return pick ? pick.url : null;
  }

  function photoImg(src, size, alt) {
    const img = el("img", "xg-img");
    img.alt = alt || "";
    img.decoding = "async";
    img.loading = "lazy";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => img.classList.add("xg-loaded"));
    img.src = XG.parse.photoUrl(src, size);
    return img;
  }

  // One cell of the grid-card / compact-post media layout. Videos and GIFs are
  // muted looping <video>s that the observer plays; a variant-less one falls back
  // to its poster image.
  function gridCell(m, size) {
    const cell = el("div", "xg-cell");
    const src = m.type === "video" || m.type === "gif" ? gridVariant(m) : null;
    if (src) {
      const v = el("video", "xg-vid");
      silentLoop(v);
      v.preload = "none";
      v.poster = XG.parse.photoUrl(m.src, size);
      v.src = src;
      if (m.alt) v.setAttribute("aria-label", m.alt);
      cell.appendChild(v);
      watchVideo(v);
    } else {
      cell.appendChild(photoImg(m.src, size, m.alt));
    }
    if (m.type === "gif") cell.appendChild(el("span", "xg-badge xg-l", "GIF"));
    else if (m.type === "video" && m.durationMs) cell.appendChild(el("span", "xg-badge xg-r", fmtDuration(m.durationMs)));
    return cell;
  }

  // Media layout for grid cards and compact posts: 1 = one box at w/h,
  // 2 = two squares, 3 = 2:1 over two squares, 4 = 2x2.
  function mediaBlock(post, size, range, onPhoto) {
    const list = (post.media || []).slice(0, 4);
    if (!list.length) return null;
    const box = el("div", "xg-media");
    if (list.length === 1) {
      const m = list[0];
      box.classList.add("xg-m1");
      box.style.aspectRatio = String(clamp((m.w || 1) / (m.h || 1), range[0], range[1]));
      box.appendChild(gridCell(m, size));
    } else {
      box.classList.add("xg-mgrid", "xg-m" + list.length);
      for (const m of list) box.appendChild(gridCell(m, size));
    }
    if (onPhoto) {
      list.forEach((m, i) => {
        if (m.type !== "photo") return;
        const cell = box.querySelectorAll(".xg-cell")[i];
        cell.style.cursor = "zoom-in";
        cell.addEventListener("click", (e) => {
          e.stopPropagation();
          onPhoto(post, post.media.indexOf(m));
        });
      });
    }
    return box;
  }

  function quoteBlock(q, opts) {
    if (!q) return null;
    const box = el("div", "xg-quote");
    const main = el("div", "xg-q-main");
    const head = el("div", "xg-q-head");
    head.appendChild(avatar(q.author));
    head.append(...nameBits(q.author));
    head.appendChild(el("span", "xg-handle", "@" + q.author.handle));
    main.appendChild(head);
    if (q.text) main.appendChild(el("div", "xg-q-text", q.text));
    box.appendChild(main);
    const first = q.media && q.media[0];
    if (first) {
      const t = el("img", "xg-q-thumb");
      t.alt = "";
      t.decoding = "async";
      t.loading = "lazy";
      t.referrerPolicy = "no-referrer";
      t.src = XG.parse.photoUrl(first.src, "small");
      box.appendChild(t);
    }
    if (opts && opts.onOpen) {
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onOpen(q);
      });
    }
    return box;
  }

  const METRIC_SPEC = [
    ["replies", "reply", "Replies"],
    ["reposts", "repost", "Reposts"],
    ["likes", "heart", "Likes"],
    ["views", "chart", "Views"],
  ];

  function metricsRow(refs) {
    const row = el("div", "xg-metrics");
    for (const [k, ic, label] of METRIC_SPEC) {
      const item = el("span", "xg-mt xg-" + k);
      item.title = label;
      item.append(icon(ic), el("span", "xg-n"));
      refs[k] = item;
      row.appendChild(item);
    }
    return row;
  }

  function syncMetrics(refs, post) {
    const m = post.metrics || {};
    for (const [k] of METRIC_SPEC) {
      const item = refs[k];
      if (!item) continue;
      const v = Number(m[k]) || 0;
      item.lastChild.textContent = fmtCount(v);
      const forced = (k === "likes" && post.liked) || (k === "reposts" && post.reposted);
      item.hidden = !v && !forced;
    }
    if (refs.likes) refs.likes.classList.toggle("xg-liked", !!post.liked);
    if (refs.reposts) refs.reposts.classList.toggle("xg-reposted", !!post.reposted);
  }

  // Rough height so content-visibility has a sane placeholder before masonry
  // measures the real thing.
  function estimateHeight(post, colWidth) {
    let h = 2;
    const media = post.media || [];
    if (media.length === 1) h += colWidth / clamp((media[0].w || 1) / (media[0].h || 1), 0.56, 2.4);
    else if (media.length === 2) h += colWidth / 2;
    else if (media.length >= 3) h += colWidth;
    const maxLines = media.length ? 3 : 8;
    const cpl = Math.max(12, (colWidth - 20) / (media.length ? 6.6 : 7.2));
    let lines = 0;
    for (const p of String(post.text || "").split("\n")) lines += Math.max(1, Math.ceil(p.length / cpl));
    if (!post.text) lines = 0;
    lines = Math.min(lines, maxLines);
    h += 17 + 20 + 6 + 14 + 6; // padding, meta, gaps, metrics
    h += lines * (media.length ? 17.6 : 19) + (lines ? 6 : 0);
    if (post.quote) h += 72;
    if (post.repostedBy) h += 20;
    return h;
  }

  // ---- grid card ------------------------------------------------------------------

  // opts: { colWidth, onOpen(post, event) }
  function render(post, opts = {}) {
    const colWidth = opts.colWidth || 260;
    const hasMedia = !!(post.media && post.media.length);
    const card = el("article", "xg-card" + (hasMedia ? "" : " xg-textonly"));
    card.tabIndex = 0;
    card.dataset.id = post.id;
    const refs = {};
    const st = { kind: "grid", post, refs, opts };
    state.set(card, st);

    if (hasMedia) card.appendChild(mediaBlock(post, colWidth > 340 ? "medium" : "small", [0.56, 2.4]));

    const body = el("div", "xg-body");
    if (post.repostedBy) {
      const r = el("div", "xg-repostline");
      r.appendChild(icon("repost"));
      r.appendChild(el("span", null, (post.repostedBy.name || post.repostedBy.handle) + " reposted"));
      body.appendChild(r);
    }
    body.appendChild(metaRow(post));
    if (post.text) {
      const t = el("div", "xg-text");
      renderSegments(t, post.segments, { links: false });
      body.appendChild(t);
    }
    const q = quoteBlock(post.quote);
    if (q) body.appendChild(q);
    body.appendChild(metricsRow(refs));
    card.appendChild(body);
    syncMetrics(refs, post);
    card.style.setProperty("--xg-est", Math.round(estimateHeight(post, colWidth)) + "px");

    const open = (e) => {
      if (e.ctrlKey || e.metaKey) openTab(st.post);
      else if (opts.onOpen) opts.onOpen(st.post, e);
    };
    card.addEventListener("click", open);
    card.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault(); // no autoscroll cursor on middle-click
    });
    card.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        openTab(st.post);
      }
    });
    card.addEventListener("keydown", (e) => {
      if (e.target === card && e.key === "Enter") {
        e.preventDefault();
        open(e);
      }
    });
    return card;
  }

  // ---- thread posts (drawer) -----------------------------------------------------------

  function actBtn(kind, st, opts) {
    const b = el("button", "xg-act");
    b.type = "button";
    b.dataset.kind = kind;
    b.setAttribute("aria-label", kind === "like" ? "Like" : "Repost");
    b.append(icon(kind === "like" ? "heart" : "repost"), el("span", "xg-n"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!b.disabled && opts.onAct) opts.onAct(st.post, kind, b);
    });
    return b;
  }

  function actsRow(st, opts) {
    const row = el("div", "xg-acts");
    const reply = el("span", "xg-act xg-static");
    reply.title = "Replies";
    reply.append(icon("reply"), el("span", "xg-n"));
    st.refs.replyN = reply.lastChild;
    st.refs.replyWrap = reply;
    st.refs.repostBtn = actBtn("repost", st, opts);
    st.refs.likeBtn = actBtn("like", st, opts);
    row.append(reply, st.refs.repostBtn, st.refs.likeBtn);
    return row;
  }

  function syncActs(refs, post) {
    const m = post.metrics || {};
    if (refs.likeBtn) {
      refs.likeBtn.classList.toggle("xg-liked", !!post.liked);
      refs.likeBtn.setAttribute("aria-pressed", String(!!post.liked));
      refs.likeBtn.lastChild.textContent = m.likes ? fmtCount(m.likes) : "";
    }
    if (refs.repostBtn) {
      refs.repostBtn.classList.toggle("xg-reposted", !!post.reposted);
      refs.repostBtn.setAttribute("aria-pressed", String(!!post.reposted));
      refs.repostBtn.lastChild.textContent = m.reposts ? fmtCount(m.reposts) : "";
    }
    if (refs.replyN) refs.replyN.textContent = m.replies ? fmtCount(m.replies) : "";
  }

  function compactPost(post, opts) {
    const art = el("article", "xg-tp");
    art.tabIndex = 0;
    art.dataset.id = post.id;
    const st = { kind: "compact", post, refs: {}, opts };
    state.set(art, st);

    const side = el("div", "xg-tp-side");
    side.append(avatar(post.author, "", false), el("span", "xg-tp-line"));
    const main = el("div", "xg-tp-main");
    main.appendChild(metaRow(post, { withAvatar: false }));
    if (post.text) {
      const t = el("div", "xg-tp-text");
      renderSegments(t, post.segments, { links: true });
      main.appendChild(t);
    }
    const media = mediaBlock(post, "medium", [0.75, 2.2], opts.onPhoto);
    if (media) main.appendChild(media);
    const q = quoteBlock(post.quote, opts);
    if (q) main.appendChild(q);
    main.appendChild(actsRow(st, opts));
    art.append(side, main);
    syncActs(st.refs, post);

    art.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) openTab(st.post);
      else if (opts.onOpen) opts.onOpen(st.post);
    });
    art.addEventListener("keydown", (e) => {
      if (e.target === art && e.key === "Enter") {
        e.preventDefault();
        if (opts.onOpen) opts.onOpen(st.post);
      }
    });
    return art;
  }

  // Highest mp4 variant at or under 2.5 Mbps (variants are sorted ascending).
  function pickVariant(m) {
    const v = (m.variants || []).filter((x) => x && x.url);
    if (!v.length) return null;
    let best = null;
    for (const x of v) if ((Number(x.bitrate) || 0) <= 2500000) best = x;
    return (best || v[0]).url;
  }

  function focalMedia(post, opts) {
    const wrap = el("div", "xg-fmedia");
    (post.media || []).forEach((m, i) => {
      const item = el("div", "xg-fitem");
      const ratio = String(clamp((m.w || 1) / (m.h || 1), 0.2, 5));
      const src = m.type === "photo" ? null : pickVariant(m);
      if (m.type === "photo" || !src) {
        const img = el("img");
        img.alt = m.alt || "";
        img.decoding = "async";
        img.loading = i === 0 ? "eager" : "lazy";
        img.referrerPolicy = "no-referrer";
        img.style.aspectRatio = ratio;
        img.src = XG.parse.photoUrl(m.src, "large");
        if (m.type === "photo") {
          img.addEventListener("click", () => opts.onPhoto && opts.onPhoto(post, i));
        }
        item.appendChild(img);
        if (m.alt) {
          const b = el("span", "xg-badge xg-l", "ALT");
          b.title = m.alt;
          item.appendChild(b);
        }
      } else {
        const v = el("video");
        silentLoop(v);
        v.poster = XG.parse.photoUrl(m.src, "large");
        v.style.aspectRatio = ratio;
        v.src = src;
        item.appendChild(v);
        if (m.type === "gif") {
          item.appendChild(el("span", "xg-badge xg-l", "GIF"));
        } else {
          v.controls = true; // unmuting is the user's call
          v.preload = "metadata";
        }
        watchVideo(v);
      }
      wrap.appendChild(item);
    });
    return wrap;
  }

  const FULL_SPEC = [
    ["replies", "Reply", "Replies"],
    ["reposts", "Repost", "Reposts"],
    ["quotes", "Quote", "Quotes"],
    ["likes", "Like", "Likes"],
    ["bookmarks", "Bookmark", "Bookmarks"],
    ["views", "View", "Views"],
  ];

  function syncFull(refs, post) {
    if (!refs.full) return;
    const m = post.metrics || {};
    for (const [k, one, many] of FULL_SPEC) {
      const item = refs.full[k];
      const v = Number(m[k]) || 0;
      item.hidden = !v;
      item.firstChild.textContent = v.toLocaleString("en-US");
      item.lastChild.textContent = " " + (v === 1 ? one : many);
    }
  }

  function focalPost(post, opts) {
    const art = el("article", "xg-fp");
    art.dataset.id = post.id;
    const st = { kind: "focal", post, refs: {}, opts };
    state.set(art, st);

    if (post.repostedBy) {
      const r = el("div", "xg-fp-repost");
      r.appendChild(icon("repost"));
      r.appendChild(el("span", null, (post.repostedBy.name || post.repostedBy.handle) + " reposted"));
      art.appendChild(r);
    }
    const head = el("div", "xg-fp-head");
    const who = el("div", "xg-fp-who");
    const nm = el("div", "xg-fp-name");
    nm.appendChild(el("span", null, post.author.name || post.author.handle));
    if (post.author.verified) nm.appendChild(icon("verified", "xg-vbadge"));
    who.append(nm, el("span", "xg-fp-handle", "@" + post.author.handle));
    head.append(avatar(post.author, "", true), who);
    art.appendChild(head);

    if (post.text) {
      const t = el("div", "xg-fp-text");
      renderSegments(t, post.segments, { links: true });
      art.appendChild(t);
    }
    if (post.media && post.media.length) art.appendChild(focalMedia(post, opts));
    const q = quoteBlock(post.quote, opts);
    if (q) art.appendChild(q);

    art.appendChild(el("div", "xg-fp-time", fmtFull(post.createdAt)));
    const full = el("div", "xg-fp-metrics");
    st.refs.full = {};
    for (const [k] of FULL_SPEC) {
      const item = el("span");
      item.append(el("b"), el("span"));
      st.refs.full[k] = item;
      full.appendChild(item);
    }
    art.appendChild(full);
    art.appendChild(actsRow(st, opts));
    syncFull(st.refs, post);
    syncActs(st.refs, post);
    return art;
  }

  // opts: { variant: "focal" | "compact", onOpen(post), onAct(post, kind, btn), onPhoto(post, mediaIndex) }
  function renderThread(post, opts = {}) {
    return opts.variant === "focal" ? focalPost(post, opts) : compactPost(post, opts);
  }

  // Refresh metrics and the liked / reposted tint in place. Works on any
  // element this module rendered.
  function update(elm, post) {
    const st = state.get(elm);
    if (!st || !post) return;
    st.post = post;
    if (st.kind === "grid") syncMetrics(st.refs, post);
    else {
      syncActs(st.refs, post);
      syncFull(st.refs, post);
    }
  }

  XG.cards = {
    render,
    renderThread,
    update,
    segments: renderSegments,
    safeHref,
    openTab,
    pickVariant,
    gridVariant,
    watchVideos,
    sweepVideos,
    fmtCount,
    fmtTime,
    fmtFull,
    fmtDuration,
  };
})();
