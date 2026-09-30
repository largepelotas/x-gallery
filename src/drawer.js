// The thread side panel. Fixed to the right, no backdrop, own scroll. It shows
// the focal post at once from what we already have, and fills in ancestors and
// replies when a matching TweetDetail response arrives.
//
// deps: {
//   store,                    XG.createStore instance (setPostState only)
//   toast(msg),
//   openLightbox(post, i),    i = index into post.media
//   onOpenThread(post),       a compact post or quote was clicked: navigate to it
//   onUserClose(),            x button (Esc arrives via the overlay)
//   onReplyInX(),             hide the overlay so X's own status page is usable
//   onPostChanged(id),        like/repost applied: refresh the grid card
//   requestMore(),            the drawer's sentinel is visible and more replies exist
//   onRetry(),                Retry pressed in the footer error state
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

  const LOAD_TIMEOUT_MS = 8000;
  const CLOSE_CLEAR_MS = 280;

  XG.createDrawer = function createDrawer(root, deps = {}) {
    const C = XG.cards;

    // ---- DOM ------------------------------------------------------------------
    const panel = el("aside", "xg-drawer");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Post");
    panel.tabIndex = -1;

    const head = el("div", "xg-dhead");
    const replyBtn = el("button", "xg-btn");
    replyBtn.type = "button";
    replyBtn.append(icon("reply"), el("span", null, "Reply in X"));
    const ext = el("a", "xg-iconbtn");
    ext.target = "_blank";
    ext.rel = "noopener";
    ext.title = "Open in new tab";
    ext.setAttribute("aria-label", "Open in new tab");
    ext.appendChild(icon("external"));
    const closeBtn = el("button", "xg-iconbtn");
    closeBtn.type = "button";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.appendChild(icon("close"));
    head.append(el("h2", null, "Post"), replyBtn, ext, closeBtn);
    // The header doesn't scroll; keep wheel from chaining to X's page underneath.
    head.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });

    const body = el("div", "xg-dbody");
    const ancEl = el("div", "xg-anc");
    const focalWrap = el("div", "xg-focal");
    const tstatus = el("div", "xg-tstatus");
    const groupsEl = el("div", "xg-groups");
    const sentinel = el("div", "xg-dsentinel");
    const foot = el("div", "xg-dfoot");
    body.append(ancEl, focalWrap, tstatus, groupsEl, sentinel, foot);
    panel.append(head, body);
    root.appendChild(panel);
    tstatus.hidden = true;

    // ---- state ------------------------------------------------------------------
    let open = false;
    let focal = null;
    let model = null; // thread model for the current focal id
    let timer = 0;
    let closeGen = 0;
    let prevFocus = null;
    let ancRendered = [];
    const cache = new Map(); // focal id -> model, so reopening works without a request
    const byId = new Map(); // post id -> Set<element> currently rendered
    const groupEls = new Map(); // group key -> { el, count }

    const reg = (id, node) => {
      let s = byId.get(id);
      if (!s) byId.set(id, (s = new Set()));
      s.add(node);
    };
    const unreg = (id, node) => {
      const s = byId.get(id);
      if (s) s.delete(node);
    };

    // ---- thread model ---------------------------------------------------------------
    function newModel(fid) {
      return {
        ancestors: [],
        ancIds: new Set(),
        groups: [],
        groupByKey: new Map(),
        seen: new Set([fid]),
        hasDetail: false,
        done: false,
        focalDetail: null,
      };
    }

    function addGroup(m, key, posts) {
      let g = m.groupByKey.get(key);
      const created = !g;
      if (created) g = { key, posts: [] };
      for (const p of posts || []) {
        if (!p || m.seen.has(p.id)) continue;
        m.seen.add(p.id);
        g.posts.push(p);
      }
      if (created && g.posts.length) {
        m.groupByKey.set(key, g);
        m.groups.push(g);
      }
    }

    // Ancestors are the single-post entries before the focal one. Everything
    // after it (modules, or lone posts in later responses) is a reply group.
    function mergeDetail(m, parsed, fid) {
      const items = parsed.items || [];
      const fi = items.findIndex((it) => it && it.kind === "post" && it.post && it.post.id === fid);
      if (fi !== -1) m.focalDetail = items[fi].post;
      items.forEach((it, i) => {
        if (!it) return;
        if (it.kind === "post") {
          const p = it.post;
          if (!p || p.id === fid) return;
          if (fi !== -1 && i < fi) {
            if (!m.ancIds.has(p.id)) {
              m.ancIds.add(p.id);
              m.seen.add(p.id);
              m.ancestors.push(p);
            }
          } else addGroup(m, it.entryId, [p]);
        } else if (it.kind === "module") addGroup(m, it.entryId, it.posts);
      });
      for (const a of parsed.moduleAdds || []) addGroup(m, a.entryId, a.posts);
      m.hasDetail = true;
      m.done = !parsed.cursorBottom;
    }

    // ---- like / repost -----------------------------------------------------------------
    function copyMutable(dst, src) {
      dst.liked = src.liked;
      dst.reposted = src.reposted;
      dst.metrics = Object.assign(dst.metrics || {}, src.metrics);
    }

    function applyState(post, patch) {
      const s = deps.store ? deps.store.setPostState(post.id, patch) : undefined;
      if (s && s !== post) copyMutable(post, s);
      else if (!s) {
        // Not in the store (a detail-only post): adjust our own copy the same way.
        post.metrics = post.metrics || {};
        if (patch.liked !== undefined && patch.liked !== post.liked) {
          post.liked = patch.liked;
          post.metrics.likes = Math.max(0, (post.metrics.likes || 0) + (post.liked ? 1 : -1));
        }
        if (patch.reposted !== undefined && patch.reposted !== post.reposted) {
          post.reposted = patch.reposted;
          post.metrics.reposts = Math.max(0, (post.metrics.reposts || 0) + (post.reposted ? 1 : -1));
        }
      }
      for (const node of byId.get(post.id) || []) C.update(node, post);
      if (deps.onPostChanged) deps.onPostChanged(post.id);
    }

    async function act(post, kind) {
      const want = kind === "like" ? !post.liked : !post.reposted;
      const btns = [];
      for (const node of byId.get(post.id) || []) {
        for (const b of node.querySelectorAll('.xg-act[data-kind="' + kind + '"]')) btns.push(b);
      }
      for (const b of btns) {
        b.disabled = true;
        b.setAttribute("aria-busy", "true");
      }
      let res = null;
      try {
        res = await (kind === "like" ? XG.native.setLiked(post.id, want) : XG.native.setReposted(post.id, want));
      } catch {
        res = null;
      }
      for (const b of btns) {
        b.disabled = false;
        b.removeAttribute("aria-busy");
      }
      if (typeof res !== "boolean") {
        if (deps.toast) deps.toast("Couldn't reach X's button — open the post in X");
        return;
      }
      applyState(post, kind === "like" ? { liked: res } : { reposted: res });
      // The click went through but X never flipped: don't fail silently.
      if (res !== want && deps.toast) deps.toast("Couldn't reach X's button — open the post in X");
    }

    const cardOpts = (variant) => ({
      variant,
      onOpen: (p) => deps.onOpenThread && deps.onOpenThread(p),
      onAct: act,
      onPhoto: (p, i) => deps.openLightbox && deps.openLightbox(p, i),
    });

    // ---- rendering ---------------------------------------------------------------------------
    function makeCompact(post) {
      const node = C.renderThread(post, cardOpts("compact"));
      reg(post.id, node);
      return node;
    }

    function renderFocal() {
      const node = C.renderThread(focal, cardOpts("focal"));
      reg(focal.id, node);
      focalWrap.replaceChildren(node);
      C.sweepVideos();
    }

    function renderAncestors() {
      for (const n of ancRendered) unreg(n.dataset.id, n);
      ancRendered = model.ancestors.map(makeCompact);
      ancEl.replaceChildren(...ancRendered);
      C.sweepVideos();
    }

    function syncGroups() {
      for (const g of model.groups) {
        let ge = groupEls.get(g.key);
        if (!ge) {
          ge = { el: el("div", "xg-group"), count: 0 };
          groupEls.set(g.key, ge);
          groupsEl.appendChild(ge.el);
        }
        for (; ge.count < g.posts.length; ge.count++) ge.el.appendChild(makeCompact(g.posts[ge.count]));
      }
    }

    function showLoading() {
      tstatus.hidden = false;
      tstatus.replaceChildren(el("span", "xg-spin"), el("span", null, "Loading thread…"));
    }

    function showError() {
      if (!open || (model && model.hasDetail)) return;
      tstatus.hidden = false;
      const a = el("a", "xg-btn", "Open in new tab");
      const href = C.safeHref(focal && focal.url);
      if (href) {
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
      }
      tstatus.replaceChildren(el("span", null, "Couldn't load the thread from X."), a);
    }

    function refreshThread() {
      if (!model || !focal) return;
      const d = model.focalDetail;
      if (d && d !== focal) {
        // Freshest counts and state, applied to the object we already display.
        copyMutable(focal, d);
        for (const node of byId.get(focal.id) || []) C.update(node, focal);
      }
      tstatus.hidden = true;
      const hadAnc = ancRendered.length;
      if (model.ancestors.length !== hadAnc) {
        renderAncestors();
        // Ancestors appear above the focal post; keep the focal post in view.
        if (!hadAnc && ancRendered.length && body.scrollTop < 40) body.scrollTop = focalWrap.offsetTop;
      }
      syncGroups();
      recheck();
    }

    // ---- footer status ----------------------------------------------------------------------------
    // `msg` overrides the error text; a custom message has no Retry (nothing to retry).
    function setStatus(s, msg) {
      if (s === "loading") {
        const d = el("div", "xg-status");
        d.append(el("span", "xg-spin"), el("span", null, "Loading replies…"));
        foot.replaceChildren(d);
      } else if (s === "error") {
        const d = el("div", "xg-status");
        d.appendChild(el("span", null, msg || "Couldn't load more replies"));
        if (!msg) {
          const b = el("button", "xg-btn");
          b.type = "button";
          b.append(icon("refresh"), el("span", null, "Retry"));
          b.addEventListener("click", () => deps.onRetry && deps.onRetry());
          d.appendChild(b);
        }
        foot.replaceChildren(d);
      } else foot.replaceChildren();
    }

    // ---- pager sentinel ------------------------------------------------------------------------------
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        if (open && model && model.hasDetail && !model.done && deps.requestMore) deps.requestMore();
      },
      { root: body, rootMargin: "0px 0px 600px 0px" }
    );
    io.observe(sentinel);
    function recheck() {
      io.unobserve(sentinel);
      io.observe(sentinel);
    }

    // ---- public ---------------------------------------------------------------------------------------
    function openPost(post) {
      if (!post) return;
      const was = open;
      if (!was) prevFocus = root.getRootNode().activeElement || null;
      open = true;
      focal = post;
      clearTimeout(timer);
      closeGen++;
      model = cache.get(post.id) || null;
      byId.clear();
      groupEls.clear();
      ancRendered = [];
      ancEl.replaceChildren();
      groupsEl.replaceChildren();
      body.scrollTop = 0;
      const href = C.safeHref(post.url);
      if (href) ext.href = href;
      else ext.removeAttribute("href");
      setStatus("idle");
      renderFocal();
      panel.classList.add("xg-open");
      if (model && model.hasDetail) refreshThread();
      else {
        showLoading();
        timer = setTimeout(showError, LOAD_TIMEOUT_MS);
      }
      if (!was) panel.focus({ preventScroll: true });
      recheck();
    }

    function close() {
      if (!open) return;
      open = false;
      clearTimeout(timer);
      panel.classList.remove("xg-open");
      const gen = ++closeGen;
      setTimeout(() => {
        // After the slide-out: drop the DOM so videos stop and memory is freed.
        if (open || gen !== closeGen) return;
        focalWrap.replaceChildren();
        ancEl.replaceChildren();
        groupsEl.replaceChildren();
        byId.clear();
        groupEls.clear();
        ancRendered = [];
        focal = null;
        model = null;
        C.sweepVideos();
      }, CLOSE_CLEAR_MS);
      const back = prevFocus;
      prevFocus = null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
    }

    function ingestDetail(parsed, focalId) {
      if (!parsed) return;
      const fid = String(focalId ?? parsed.focalId ?? "");
      if (!fid) return;
      let m = cache.get(fid);
      if (!m) cache.set(fid, (m = newModel(fid)));
      mergeDetail(m, parsed, fid);
      if (open && focal && focal.id === fid) {
        model = m;
        clearTimeout(timer);
        refreshThread();
      }
    }

    function onPostUpdated(post) {
      if (!post) return;
      for (const node of byId.get(post.id) || []) C.update(node, post);
    }

    replyBtn.addEventListener("click", () => deps.onReplyInX && deps.onReplyInX());
    closeBtn.addEventListener("click", () => deps.onUserClose && deps.onUserClose());

    return {
      open: openPost,
      close,
      ingestDetail,
      onPostUpdated,
      recheck,
      setStatus,
      get isOpen() {
        return open;
      },
      get focalId() {
        return focal ? focal.id : null;
      },
      get done() {
        return !!(model && model.done);
      },
    };
  };
})();
