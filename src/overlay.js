// The overlay shell: one host element with an open shadow root holding the
// toolbar, the grid, the new-posts pill, the footer, the lightbox and a toast,
// plus the floating "Gallery" pill shown while the gallery is hidden. It owns no
// data: content.js drives it through the setters below and hears about user
// intent through the callbacks in `opts`.
//
// opts: {
//   columns,                      initial 3|4|5
//   onFilterToggle(key), onColumns(n), onHide(), onShowGallery(),
//   onFlushNew(), onNeedMore(), onRetry(),
//   onEscape() -> bool            Esc with the lightbox closed; true = handled
// }
(() => {
  const XG = (globalThis.XG ??= {});

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const icon = (n, c) => XG.icons.el(n, c);

  const FILTERS = [
    ["hideReplies", "Hide replies"],
    ["hideReposts", "Hide reposts"],
    ["mediaOnly", "Media only"],
    ["followingOnly", "Following only"],
  ];
  const SOURCE_LABEL = { HomeTimeline: "For you", HomeLatestTimeline: "Following" };
  const TOAST_MS = 3800;

  XG.createOverlay = function createOverlay(opts = {}) {
    // ---- host + shadow root ------------------------------------------------------
    const host = document.createElement("div");
    host.id = "xg-host";
    const hs = host.style; // CSSOM, not a style attribute: X's CSP doesn't apply
    hs.position = "fixed";
    hs.inset = "0";
    hs.zIndex = "2147483000";
    hs.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "open" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(XG.styles.css);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      console.error("[xg] could not adopt the stylesheet", e);
    }

    // ---- structure -------------------------------------------------------------------
    const root = el("div", "xg-root");
    root.hidden = true;
    const scroller = el("div", "xg-scroller");

    const toolbar = el("div", "xg-toolbar");
    const title = el("div", "xg-title");
    title.append(icon("grid"), el("span", "xg-label", "Gallery"));
    const source = el("span", "xg-source");
    source.hidden = true;
    const chips = el("div", "xg-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Filters");
    const chipEls = {};
    for (const [key, label] of FILTERS) {
      const b = el("button", "xg-chip", label);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => opts.onFilterToggle && opts.onFilterToggle(key));
      chipEls[key] = b;
      chips.appendChild(b);
    }
    const seg = el("div", "xg-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Columns");
    const segEls = {};
    for (const n of [3, 4, 5]) {
      const b = el("button", null, String(n));
      b.type = "button";
      b.setAttribute("aria-label", n + " columns");
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => opts.onColumns && opts.onColumns(n));
      segEls[n] = b;
      seg.appendChild(b);
    }
    const count = el("span", "xg-count", "0 / 0");
    const hideBtn = el("button", "xg-iconbtn");
    hideBtn.type = "button";
    hideBtn.title = "Hide gallery";
    hideBtn.setAttribute("aria-label", "Hide gallery");
    hideBtn.appendChild(icon("close"));
    hideBtn.addEventListener("click", () => opts.onHide && opts.onHide());
    toolbar.append(title, source, chips, seg, count, hideBtn);

    const newpill = el("div", "xg-newpill");
    newpill.hidden = true;
    const newbtn = el("button", "xg-newbtn");
    newbtn.type = "button";
    const newLabel = el("span", null, "0 new posts");
    newbtn.append(icon("arrowUp"), newLabel);
    newbtn.addEventListener("click", () => opts.onFlushNew && opts.onFlushNew());
    newpill.appendChild(newbtn);

    const empty = el("div", "xg-empty", "Waiting for your timeline…");
    const grid = el("div", "xg-grid");
    const footer = el("div", "xg-footer");
    const sentinel = el("div", "xg-sentinel");
    const statusEl = el("div", "xg-status");
    footer.append(sentinel, statusEl);
    scroller.append(toolbar, newpill, empty, grid, footer);

    const toastEl = el("div", "xg-toast");
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    root.append(scroller, toastEl);

    const pill = el("button", "xg-pill");
    pill.type = "button";
    pill.hidden = true;
    pill.setAttribute("aria-label", "Show gallery");
    pill.append(icon("grid"), el("span", null, "Gallery"));
    pill.addEventListener("click", () => opts.onShowGallery && opts.onShowGallery());

    shadow.append(root, pill);
    document.documentElement.appendChild(host);

    const masonry = XG.createMasonry(grid, { columns: opts.columns || 4, gap: 8, scroller });

    // ---- state -------------------------------------------------------------------------
    let visible = false;
    let savedTop = 0; // display:none resets scrollTop, so remember it across hide/show
    let toastTimer = 0;
    let lb = null;

    function refreshTheme() {
      let t = "dark";
      try {
        t = XG.env.pageTheme();
      } catch {}
      host.setAttribute("data-theme", t === "light" || t === "dim" ? t : "dark");
    }
    refreshTheme();

    function recheck() {
      io.unobserve(sentinel);
      io.observe(sentinel);
    }

    const io = new IntersectionObserver(
      (es) => {
        if (visible && es.some((e) => e.isIntersecting) && opts.onNeedMore) opts.onNeedMore();
      },
      { root: scroller, rootMargin: "0px 0px 1500px 0px" }
    );
    io.observe(sentinel);

    function setVisible(v) {
      v = !!v;
      if (v === visible) return;
      if (!v) {
        savedTop = scroller.scrollTop;
        closeLightbox();
      }
      visible = v;
      if (v) {
        refreshTheme();
        root.hidden = false;
        scroller.scrollTop = savedTop;
        recheck();
      } else {
        root.hidden = true;
      }
    }

    function setPillVisible(v) {
      pill.hidden = !v;
    }

    function setSource(op) {
      const label = SOURCE_LABEL[op] || "";
      source.textContent = label;
      source.hidden = !label;
    }

    function setCounts(shown, loaded) {
      count.textContent = shown + " / " + loaded;
      count.title = shown + " shown of " + loaded + " loaded";
    }

    function setNewCount(n) {
      newpill.hidden = !(n > 0);
      if (n > 0) newLabel.textContent = n + (n === 1 ? " new post" : " new posts");
    }

    function setFilters(filters) {
      for (const [key] of FILTERS) chipEls[key].setAttribute("aria-pressed", String(!!(filters && filters[key])));
    }

    function setColumns(n) {
      for (const k of Object.keys(segEls)) segEls[k].setAttribute("aria-pressed", String(Number(k) === n));
      masonry.setColumns(n);
    }

    // kind: null (hide) | "waiting" | "filtered"
    function setEmpty(kind) {
      empty.hidden = !kind;
      if (kind === "filtered") empty.textContent = "No loaded posts match these filters.";
      else if (kind) empty.textContent = "Waiting for your timeline…";
    }

    // state: "idle" | "loading" | "error"
    function setStatus(s) {
      statusEl.replaceChildren();
      if (s === "loading") {
        statusEl.append(el("span", "xg-spin"), el("span", null, "Loading more…"));
      } else if (s === "error") {
        const b = el("button", "xg-btn");
        b.type = "button";
        b.append(icon("refresh"), el("span", null, "Retry"));
        b.addEventListener("click", () => opts.onRetry && opts.onRetry());
        statusEl.append(el("span", null, "Couldn't load more"), b);
      }
    }

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add("xg-on");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove("xg-on"), TOAST_MS);
    }

    function scrollToTop() {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    }

    // ---- lightbox ---------------------------------------------------------------------------
    function lbShow(i) {
      const n = lb.photos.length;
      lb.i = ((i % n) + n) % n;
      const m = lb.photos[lb.i];
      lb.img.src = XG.parse.photoUrl(m.src, "orig");
      lb.img.alt = m.alt || "";
      lb.cap.textContent = m.alt || "";
      const multi = n > 1;
      lb.prev.hidden = !multi;
      lb.next.hidden = !multi;
    }

    function lbStep(d) {
      if (lb && lb.photos.length > 1) lbShow(lb.i + d);
    }

    function openLightbox(post, mediaIndex) {
      const photos = ((post && post.media) || []).filter((m) => m.type === "photo");
      if (!photos.length) return;
      const start = Math.max(0, photos.indexOf(post.media[mediaIndex]));
      closeLightbox();
      const box = el("div", "xg-lightbox");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Photo viewer");
      const img = el("img", "xg-lb-img");
      img.draggable = false;
      img.referrerPolicy = "no-referrer";
      const cap = el("div", "xg-lb-cap");
      const mk = (cls, label, ic, fn) => {
        const b = el("button", "xg-lb-btn " + cls);
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.appendChild(icon(ic));
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          fn();
        });
        return b;
      };
      const prev = mk("xg-lb-prev", "Previous photo", "chevronLeft", () => lbStep(-1));
      const next = mk("xg-lb-next", "Next photo", "chevronRight", () => lbStep(1));
      const close = mk("xg-lb-close", "Close", "close", () => closeLightbox());
      box.append(img, cap, prev, next, close);
      box.addEventListener("click", (e) => {
        if (e.target === box) closeLightbox(); // the scrim, not the photo
      });
      box.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
      lb = { box, img, cap, prev, next, photos, i: start, back: shadow.activeElement };
      root.appendChild(box);
      lbShow(start);
      close.focus({ preventScroll: true });
    }

    function closeLightbox() {
      if (!lb) return;
      const { box, back } = lb;
      lb = null;
      box.remove();
      if (back && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
    }

    // ---- keyboard ---------------------------------------------------------------------------------
    const editable = (e) => {
      const t = e.composedPath && e.composedPath()[0];
      return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
    };
    const swallow = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    function onKeyDown(e) {
      // Synthetic events (our own Escape that closes X's menu) pass straight through.
      if (!visible || !e.isTrusted) return;
      if (e.key === "Escape") {
        if (lb) {
          closeLightbox();
          swallow(e);
        } else if (opts.onEscape && opts.onEscape()) swallow(e);
        return;
      }
      if (lb && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        lbStep(e.key === "ArrowLeft" ? -1 : 1);
        swallow(e);
        return;
      }
      // X's single-key shortcuts (l, t, n, j, k...) must not fire on the hidden page.
      if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey && !editable(e)) {
        e.stopImmediatePropagation();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);

    return {
      host,
      shadow,
      root,
      scroller,
      grid,
      masonry,
      sentinel,
      setVisible,
      setPillVisible,
      refreshTheme,
      setSource,
      setCounts,
      setNewCount,
      setFilters,
      setColumns,
      setEmpty,
      setStatus,
      toast,
      scrollToTop,
      recheck,
      openLightbox,
      closeLightbox,
      get visible() {
        return visible;
      },
      get lightboxOpen() {
        return !!lb;
      },
      destroy() {
        window.removeEventListener("keydown", onKeyDown, true);
        io.disconnect();
        masonry.destroy();
        host.remove();
      },
    };
  };
})();
