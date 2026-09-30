// Entry point for the isolated world: wires the message bridge, store, overlay,
// drawer, router polling and the pager together. See DESIGN.md §Wiring.
(() => {
  const XG = (globalThis.XG ??= {});

  // Under file:// (the dev harness) location.origin is "null", which is not a
  // valid postMessage target.
  const TARGET = /^https?:$/.test(location.protocol) ? location.origin : "*";
  const HOME_RE = /^\/home\/?$/i;
  const MAX_BUFFER = 60;

  // ---- bridge: register at once, buffer until the UI is mounted ---------------------
  const buffer = [];
  let handler = null;
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const m = e.data;
    if (!m || typeof m !== "object" || m.__xg !== "resp") return;
    if (handler) handler(m);
    else {
      buffer.push(m);
      if (buffer.length > MAX_BUFFER) buffer.shift();
    }
  });

  const domReady =
    document.readyState === "loading"
      ? new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }))
      : Promise.resolve();

  Promise.all([XG.settings.load(), domReady])
    .then(([settings]) => mount(settings))
    .catch((err) => console.error("[xg] failed to start", err));

  function mount(settings) {
    const store = XG.createStore({ viewerId: XG.env.viewerId() });
    store.setFilters(settings.filters);
    const state = { enabled: settings.enabled, columns: settings.columns, tempHidden: false };
    const cardEls = new Map(); // post id -> grid card element; re-rendered only on reset
    const warned = new Set();
    const save = (partial) => XG.settings.save(partial).catch(() => {});

    // Navigation (DESIGN.md §Wiring). Nothing here infers history depth, because the
    // extension can't see which entries X created. `visited` is every post opened in the
    // drawer this session; a change of route to one of them shows it, and x always
    // goes Home through X's own Home link.
    const visited = new Map(); // id -> post; never pruned
    let inflight = null; // { id, path, until }: navigate sent, route hasn't reached the post yet
    let abandoned = null; // { id, until }: x was pressed while this navigation was in flight
    let closingUntil = 0; // we just closed: keep the overlay up until the route reads /home, or this passes
    let lastRoute = XG.env.route();
    let warnedNav = false;
    const NAV_GRACE_MS = 2500;
    const CLOSE_GRACE_MS = 1500;
    const NAV_FAIL_MSG = "Couldn't open this thread in X — like/repost may not work.";

    // ---- pager -------------------------------------------------------------------------
    const pager = { waiting: false, kind: "home", nudges: 0, timer: 0 };

    const setPagerStatus = (s) => (pager.kind === "detail" ? drawer.setStatus(s) : overlay.setStatus(s));

    // Is the page underneath the wrong one for this kind of paging?
    function wrongPage(kind) {
      const r = XG.env.route();
      if (kind === "home") return drawer.isOpen || !HOME_RE.test(r);
      return !drawer.isOpen || !drawer.focalId || statusIdOf(r) !== drawer.focalId;
    }

    function armPager() {
      clearTimeout(pager.timer);
      pager.timer = setTimeout(() => {
        if (!pager.waiting) return;
        // Every nudge re-checks the page underneath. If it changed, give up silently:
        // no scroll, no Retry state, and nothing overwrites the drawer's messages.
        if (wrongPage(pager.kind)) {
          pager.waiting = false;
          setPagerStatus("idle");
          return;
        }
        if (pager.nudges >= 3) {
          pager.waiting = false;
          setPagerStatus("error");
          return;
        }
        pager.nudges++;
        XG.env.scrollPageBy(-1200);
        pager.nudgeTimer = setTimeout(() => {
          if (pager.waiting && !wrongPage(pager.kind)) XG.env.scrollPageToBottom();
        }, 200);
        armPager();
      }, 4000);
    }

    // Drives only the page that is actually underneath. If it's the wrong one we
    // return without marking waiting; the sentinels are re-checked on every route change.
    function requestMore(kind) {
      if (wrongPage(kind)) return;
      if (pager.waiting) return;
      pager.waiting = true;
      pager.kind = kind;
      pager.nudges = 0;
      setPagerStatus("loading");
      XG.env.scrollPageToBottom();
      armPager();
    }

    function resetPager() {
      clearTimeout(pager.timer);
      clearTimeout(pager.nudgeTimer);
      pager.waiting = false;
      overlay.setStatus("idle");
      drawer.setStatus("idle");
    }

    const retry = () => {
      const kind = pager.kind;
      resetPager();
      requestMore(kind);
    };

    // A matching response clears "waiting"; the sentinel is re-checked on the
    // next frame because a tall viewport may still show it.
    function pagerGotResponse(kind) {
      if (pager.waiting && pager.kind === kind) {
        pager.waiting = false;
        clearTimeout(pager.timer);
        setPagerStatus("idle");
      }
      requestAnimationFrame(() => (kind === "detail" ? drawer.recheck() : overlay.recheck()));
    }

    // ---- grid ----------------------------------------------------------------------------------
    function getCard(post) {
      let c = cardEls.get(post.id);
      if (!c) {
        c = XG.cards.render(post, { colWidth: overlay.masonry.colWidth(), onOpen: openThread });
        cardEls.set(post.id, c);
      }
      return c;
    }

    function refreshMeta() {
      const shown = store.visible().length;
      const total = store.size;
      overlay.setCounts(shown, total);
      overlay.setEmpty(total === 0 ? "waiting" : shown === 0 ? "filtered" : null);
    }

    function refreshPost(id) {
      const p = store.get(id);
      if (!p) return;
      const c = cardEls.get(id);
      if (c) XG.cards.update(c, p);
      drawer.onPostUpdated(p);
    }

    function onFilterToggle(key) {
      store.setFilters({ [key]: !store.filters[key] });
      overlay.setFilters(store.filters);
      overlay.masonry.relayout(store.visible().map(getCard));
      refreshMeta();
      save({ filters: { ...store.filters } });
      requestAnimationFrame(() => overlay.recheck()); // the grid may now be short enough to show the sentinel
    }

    function flushNew() {
      store.flushPending();
      overlay.setNewCount(0);
      overlay.masonry.relayout(store.visible().map(getCard));
      refreshMeta();
      overlay.scrollToTop();
    }

    // ---- responses -----------------------------------------------------------------------------
    function warnOnce(op, err) {
      if (warned.has(op)) return;
      warned.add(op);
      console.warn("[xg] could not read a " + op + " response; skipping it and carrying on", err);
    }

    function ingestHome(op, json) {
      const parsed = XG.parse.timeline(json);
      const r = store.ingestTimeline(op, parsed);
      if (r.reset) {
        cardEls.clear();
        overlay.masonry.clear();
        overlay.scroller.scrollTop = 0;
      }
      overlay.setSource(store.op);
      const fresh = r.appended.filter((p) => store.passes(p));
      overlay.masonry.append(fresh.map(getCard));
      for (const id of r.updated) refreshPost(id);
      overlay.setNewCount(r.pendingCount);
      refreshMeta();
    }

    function focalIdOf(url) {
      try {
        const v = new URL(url, location.href).searchParams.get("variables");
        const id = JSON.parse(v).focalTweetId;
        return id != null ? String(id) : null;
      } catch {
        return null;
      }
    }

    function ingestDetail(json, url) {
      const parsed = XG.parse.detail(json);
      const r = store.ingestDetail(parsed);
      for (const id of r.updated) refreshPost(id);
      const fid = focalIdOf(url);
      if (fid) drawer.ingestDetail(parsed, fid);
    }

    function handleResp(m) {
      const op = m.op;
      const isHome = op === "HomeTimeline" || op === "HomeLatestTimeline";
      if (!isHome && op !== "TweetDetail") return;
      try {
        const json = JSON.parse(m.body);
        if (isHome) ingestHome(op, json);
        else ingestDetail(json, m.url);
      } catch (err) {
        warnOnce(op, err);
      }
      pagerGotResponse(isHome ? "home" : "detail");
    }

    // ---- routes, visibility -------------------------------------------------------------------------
    const STATUS_ID_RE = /\/status\/(\d+)(?:[/?#]|$)/i; // subpaths such as /photo/1 count; the id is exact
    const statusIdOf = (r) => (STATUS_ID_RE.exec(r) || [])[1] || null;
    const isOurs = (r) => visited.has(statusIdOf(r));

    function applyVisibility() {
      const r = XG.env.route();
      const home = HOME_RE.test(r);
      const ours = isOurs(r);
      const could = home || (drawer.isOpen && ours) || !!inflight || closingUntil > 0;
      const vis = state.enabled && !state.tempHidden && could;
      overlay.setVisible(vis);
      overlay.setPillVisible((home || ours) && !vis);
    }

    function recheckSentinels() {
      requestAnimationFrame(() => {
        overlay.recheck();
        drawer.recheck();
      });
    }

    function navigateTo(path) {
      window.postMessage({ __xg: "cmd", cmd: "navigate", path }, TARGET);
    }

    // Home through X's own Home link, keeping the overlay up until the route arrives.
    function goHome(now) {
      navigateTo("/home");
      closingUntil = now + CLOSE_GRACE_MS;
    }

    function closeDrawerQuietly() {
      state.tempHidden = false;
      resetPager();
      drawer.close();
    }

    // The navigate we sent was never matched by the route: X's router ignored it. Keep the
    // drawer open on what we have and say so; nothing else changes.
    function failNavigation() {
      const e = inflight;
      inflight = null;
      resetPager();
      if (!warnedNav) {
        warnedNav = true;
        console.warn("[xg] X's router did not open " + e.path + " within " + NAV_GRACE_MS + " ms; showing it without navigation");
      }
      if (drawer.isOpen && drawer.focalId === e.id) drawer.setStatus("error", NAV_FAIL_MSG);
    }

    // The route changed (polled, or popstate). Only a change acts, so a closed drawer isn't
    // reopened just because the route still names a post. Back, Forward and X pushing a post
    // we opened all take the same path here.
    function onRouteChange(r, now, trustedPop) {
      const id = statusIdOf(r);
      inflight = null; // it arrived, or this change overtook it: either way it's no longer pending
      resetPager(); // the page underneath changed: nothing the pager waited for still applies
      if (visited.has(id)) {
        if (!trustedPop && abandoned && abandoned.id === id && now < abandoned.until) {
          // x was pressed while this navigation was in flight, and it arrived late: go home again.
          abandoned = null;
          if (drawer.isOpen) closeDrawerQuietly();
          goHome(now);
        } else if (!drawer.isOpen || drawer.focalId !== id) {
          drawer.open(visited.get(id)); // from visited plus the thread cache; no navigate
        }
      } else if (drawer.isOpen) {
        closeDrawerQuietly(); // /home, or X went somewhere that isn't ours
      }
      recheckSentinels();
    }

    // `pop` is the popstate event when called from the listener. A trusted popstate (Back/Forward)
    // counts as a change even on the same route: it may have passed through an entry no poll saw
    // (open B, Back within 400 ms). An untrusted one on the same route is someone's synthetic event.
    function tick(pop) {
      const r = XG.env.route();
      const now = Date.now();
      if (r !== lastRoute || (pop && pop.isTrusted)) {
        lastRoute = r;
        onRouteChange(r, now, !!(pop && pop.isTrusted));
      }
      if (closingUntil && (HOME_RE.test(r) || now >= closingUntil)) closingUntil = 0;
      if (inflight) {
        if (statusIdOf(r) === inflight.id) inflight = null; // the route already names it
        else if (now >= inflight.until) failNavigation();
      }
      applyVisibility();
    }

    // ---- threads ------------------------------------------------------------------------------------
    // From the grid, or a post inside the drawer.
    function openThread(post) {
      if (!post || !post.path) return;
      visited.set(post.id, post);
      abandoned = null; // an explicit open supersedes an earlier x
      state.tempHidden = false;
      resetPager();
      inflight = { id: post.id, path: post.path, until: Date.now() + NAV_GRACE_MS };
      drawer.open(post);
      navigateTo(post.path);
      applyVisibility();
      requestAnimationFrame(() => drawer.recheck());
    }

    // x or Esc.
    function userCloseDrawer() {
      if (!drawer.isOpen) return;
      const now = Date.now();
      // A navigation still in flight may land late. Remember it so that isn't mistaken for the
      // user opening the post again.
      // If the route already names it, it landed and the poll just hasn't seen it yet: nothing to abandon.
      if (inflight && statusIdOf(XG.env.route()) !== inflight.id) abandoned = { id: inflight.id, until: now + NAV_GRACE_MS };
      inflight = null;
      closeDrawerQuietly();
      if (!HOME_RE.test(XG.env.route())) goHome(now);
      applyVisibility();
      recheckSentinels();
    }

    // ---- UI -------------------------------------------------------------------------------------------
    const overlay = XG.createOverlay({
      columns: state.columns,
      onFilterToggle,
      onColumns(n) {
        state.columns = n;
        overlay.setColumns(n);
        save({ columns: n });
      },
      onHide() {
        state.enabled = false;
        save({ enabled: false });
        applyVisibility();
      },
      onShowGallery() {
        state.enabled = true;
        state.tempHidden = false;
        save({ enabled: true });
        const r = XG.env.route();
        if (isOurs(r) && !drawer.isOpen) {
          resetPager();
          drawer.open(visited.get(statusIdOf(r)));
        }
        applyVisibility();
      },
      onFlushNew: flushNew,
      onNeedMore() {
        requestMore("home");
      },
      onRetry: retry,
      onEscape() {
        if (!drawer.isOpen) return false;
        userCloseDrawer();
        return true;
      },
    });

    const drawer = XG.createDrawer(overlay.root, {
      store,
      toast: overlay.toast,
      openLightbox: overlay.openLightbox,
      onOpenThread: openThread,
      onUserClose: userCloseDrawer,
      onReplyInX() {
        state.tempHidden = true;
        applyVisibility();
      },
      onPostChanged(id) {
        const p = store.get(id);
        const c = cardEls.get(id);
        if (p && c) XG.cards.update(c, p);
      },
      requestMore: () => requestMore("detail"),
      onRetry: retry,
    });

    overlay.setFilters(store.filters);
    overlay.setColumns(state.columns);
    refreshMeta();

    handler = handleResp;
    for (const m of buffer.splice(0)) handleResp(m);

    window.addEventListener("popstate", (e) => tick(e));
    setInterval(tick, 400);
    tick();

    // Handles for the dev harness and for poking around in the console.
    XG.app = { store, overlay, drawer, state, visited, inflight: () => (inflight ? inflight.id : null) };
  }
})();
