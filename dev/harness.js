// The harness plays X. It replaces XG.env (before content.js runs), posts synthetic
// responses with the same { __xg: "resp" } messages hook.js would, answers the
// navigate command, and renders fake article[data-testid="tweet"] elements with working
// like / repost buttons so src/native.js runs for real. See DESIGN.md §Harness.
(() => {
  "use strict";
  const XG = (globalThis.XG ??= {});
  const F = window.XGFake;
  const tag = "color:#1d9bf0;font-weight:700";
  const log = (...a) => console.log("%c[harness]", tag, ...a);
  const err = (...a) => console.error("[harness]", ...a);
  if (!F) {
    err("dev/fake.js did not load; nothing to serve");
    return;
  }

  // ---- fake router: the browser's real history ---------------------------------------------
  // The route lives in the URL hash (#/handle/status/1) so real pushState also works from
  // file://. push() is history.pushState: no popstate, like X's router. Back and Forward are
  // the real history.back() / history.forward(): a popstate fires, and going out of range is
  // a silent no-op, as in a browser. The extension never walks history itself.
  const stack = ["/home"]; // our record of the entries, for the debug bar
  let pos = 0;
  const routeNow = () => decodeURIComponent(location.hash.slice(1)) || "/home";
  history.replaceState({ i: 0 }, "", location.pathname + location.search);
  const STATUS_RE = /^\/(\w+)\/status\/(\d+)$/; // what navigate commands may ask for
  const ROUTE_RE = /^\/(\w+)\/status\/(\d+)(?:\/.*)?$/; // a status page, subpaths included
  const statusId = (r) => (ROUTE_RE.exec(r) || [])[2] || null;
  function push(path) {
    stack.splice(pos + 1);
    stack.push(path);
    pos++;
    history.pushState({ i: pos }, "", "#" + path);
  }
  window.addEventListener("popstate", (e) => {
    pos = e.state && Number.isInteger(e.state.i) ? e.state.i : 0;
    log("popstate ->", routeNow());
    renderFake();
  });

  // ---- state the debug bar drives -----------------------------------------------------------
  let op = "HomeTimeline";
  let nextPage = 2;
  let theme = "dark";
  try {
    theme = localStorage.getItem("xg-harness:theme") || "dark";
  } catch {}
  const dbg = { stallPaging: false, breakButtons: false, stallThreads: false, ignoreNavigate: false };
  const droppedNavs = []; // navigates the router ignored, so "Land late" can deliver one after the fact
  const sentDetail = new Map(); // focal id -> last stage sent (a repeat visit makes no request, like X's cache)
  let homeInFlight = false;
  let detailInFlight = false;
  const BODY_BG = { dark: "#000", dim: "rgb(21,32,43)", light: "#fff" };
  const applyBodyTheme = () => {
    document.body.style.background = BODY_BG[theme] || "#000";
    document.body.style.color = theme === "light" ? "#0f1419" : "#e7e9ea";
  };
  applyBodyTheme();

  XG.env = {
    route: () => routeNow(),
    scrollPageToBottom: () => onScrollBottom(),
    scrollPageBy: (dy) => log("scrollPageBy(" + dy + ")"),
    viewerId: () => F.viewerId,
    pageTheme: () => theme,
  };

  // ---- responses -------------------------------------------------------------------------------
  function sendResp(opName, url, json) {
    window.postMessage({ __xg: "resp", op: opName, url, body: JSON.stringify(json) }, "*");
  }

  function sendHome(page) {
    log("HomeTimeline page " + page + " (" + op + ")");
    sendResp(op, "https://x.com/i/api/graphql/HARNESS/" + op + "?variables=" + encodeURIComponent("{}"), F.homePage(op, page));
    renderFake();
  }

  function sendDetail(id, stage) {
    log("TweetDetail for " + id + ", stage " + stage);
    sentDetail.set(id, stage);
    const vars = encodeURIComponent(JSON.stringify({ focalTweetId: id, with_rux_injections: false, includePromotedContent: true }));
    sendResp("TweetDetail", "https://x.com/i/api/graphql/HARNESS/TweetDetail?variables=" + vars, F.detail(id, stage));
    renderFake();
  }

  function onScrollBottom() {
    if (dbg.stallPaging) {
      log("scrolled to the bottom; ignored (Stall paging is on)");
      return;
    }
    const id = statusId(routeNow());
    if (id) {
      const stage = (sentDetail.has(id) ? sentDetail.get(id) : -1) + 1;
      if (stage > 2 || detailInFlight) return log("scrolled to the bottom; no more replies to load");
      detailInFlight = true;
      setTimeout(() => {
        detailInFlight = false;
        sendDetail(id, stage);
      }, 300);
    } else if (routeNow() === "/home") {
      if (homeInFlight) return;
      homeInFlight = true;
      setTimeout(() => {
        homeInFlight = false;
        sendHome(nextPage++);
      }, 300);
    }
  }

  function navigate(path, late) {
    if (dbg.ignoreNavigate && !late) {
      droppedNavs.push(path);
      return log("navigate " + path + " dropped (Ignore navigate is on)");
    }
    if (late) log("navigate " + path + " landing late");
    if (path === "/home") {
      // The hook clicks X's own Home link: X's router pushes /home.
      push("/home");
      log("navigate -> /home (pushed)");
      return renderFake();
    }
    const m = STATUS_RE.exec(path);
    if (!m) return err("navigate: unexpected path", path);
    push(path); // like X's router: pushState, no popstate event
    log("navigate ->", path);
    renderFake();
    const id = m[2];
    if (dbg.stallThreads) return log("thread request stalled (Stall threads is on)");
    if (sentDetail.has(id)) return log("thread served from X's own cache: no TweetDetail request");
    setTimeout(() => sendDetail(id, 0), 350);
  }

  // The router finally gets to a navigate command it had ignored (the oldest one first).
  function landLate() {
    const path = droppedNavs.shift();
    if (path === undefined) return log("Land late: nothing was ignored");
    navigate(path, true);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const m = e.data;
    if (m && m.__xg === "cmd" && m.cmd === "navigate") navigate(String(m.path));
  });

  // ---- the fake X page underneath ---------------------------------------------------------------
  const feed = document.getElementById("fx-feed");
  const routeEl = document.getElementById("fx-route");
  const decodeEnt = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  let menu = null;
  const closeMenu = () => {
    if (menu) menu.remove();
    menu = null;
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  const el = (tagName, cls, text) => {
    const e = document.createElement(tagName);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function fakeArticle(raw) {
    const leg = raw.legacy;
    const u = F.cast.find((c) => c.id === raw.core.user_results.result.rest_id) || { name: "?", handle: "unknown" };
    const a = el("article", "fx-article");
    a.setAttribute("data-testid", "tweet");

    const head = el("div", "fx-head");
    const link = el("a");
    link.href = "/" + u.handle + "/status/" + raw.rest_id;
    const time = el("time", null, "post");
    time.dateTime = new Date(Date.parse(leg.created_at) || 0).toISOString();
    link.appendChild(time);
    head.append(el("span", "fx-name", u.name), el("span", "fx-handle", "@" + u.handle), link);
    a.appendChild(head);

    const note = raw.note_tweet && raw.note_tweet.note_tweet_results.result.text;
    a.appendChild(el("div", "fx-text", decodeEnt(note || leg.full_text)));

    const q = raw.quoted_status_result && raw.quoted_status_result.result;
    if (q) {
      // A quote card carries its own permalink and <time>; native.js must not mistake it for ours.
      const card = el("div", "fx-quote");
      card.setAttribute("role", "link");
      const qa = el("a");
      const qu = F.cast.find((c) => c.id === q.core.user_results.result.rest_id) || { handle: "unknown" };
      qa.href = "/" + qu.handle + "/status/" + q.rest_id;
      qa.appendChild(el("time", null, "quoted"));
      card.append(qa, document.createTextNode(" " + decodeEnt(q.legacy.full_text)));
      a.appendChild(card);
    }

    const acts = el("div", "fx-acts");
    acts.setAttribute("role", "group");
    const reply = el("button", null, "Reply");
    reply.setAttribute("data-testid", "reply");
    const rt = el("button");
    const like = el("button");
    const sync = () => {
      rt.setAttribute("data-testid", leg.retweeted ? "unretweet" : "retweet");
      rt.textContent = (leg.retweeted ? "Reposted " : "Repost ") + leg.retweet_count;
      like.setAttribute("data-testid", leg.favorited ? "unlike" : "like");
      like.textContent = (leg.favorited ? "Liked " : "Like ") + leg.favorite_count;
    };
    like.addEventListener("click", () => {
      if (dbg.breakButtons) return log("like clicked, but 'Break X buttons' is on: nothing flips");
      setTimeout(() => {
        leg.favorited = !leg.favorited;
        leg.favorite_count += leg.favorited ? 1 : -1;
        sync();
      }, 150);
    });
    rt.addEventListener("click", () => {
      if (dbg.breakButtons) return log("repost clicked, but 'Break X buttons' is on: no menu opens");
      setTimeout(() => {
        closeMenu();
        menu = el("div", "fx-menu");
        menu.setAttribute("role", "menu");
        const item = el("div", null, leg.retweeted ? "Undo repost" : "Repost");
        item.setAttribute("role", "menuitem");
        item.setAttribute("data-testid", leg.retweeted ? "unretweetConfirm" : "retweetConfirm");
        item.addEventListener("click", () => {
          closeMenu();
          setTimeout(() => {
            leg.retweeted = !leg.retweeted;
            leg.retweet_count += leg.retweeted ? 1 : -1;
            sync();
          }, 150);
        });
        menu.appendChild(item);
        document.body.appendChild(menu);
      }, 100);
    });
    sync();
    acts.append(reply, rt, like);
    a.appendChild(acts);
    return a;
  }

  function renderFake() {
    routeEl.textContent = "route: " + routeNow();
    const id = statusId(routeNow());
    const raws = id ? F.threadRaws(id) : F.recent.slice(-12);
    feed.replaceChildren(...raws.map(fakeArticle));
  }

  // ---- debug bar -----------------------------------------------------------------------------------
  let statusEl = null;
  let errEl = null;
  let errCount = 0;

  function buildBar() {
    const bar = el("div");
    bar.id = "dbg";
    const btn = (label, fn, title) => {
      const b = el("button", null, label);
      b.type = "button";
      if (title) b.title = title;
      b.addEventListener("click", () => fn(b));
      return b;
    };
    const check = (label, key, title) => {
      const l = el("label");
      l.title = title;
      const c = el("input");
      c.type = "checkbox";
      c.addEventListener("change", () => {
        dbg[key] = c.checked;
        log(label + ": " + (c.checked ? "on" : "off"));
      });
      l.append(c, document.createTextNode(label));
      return l;
    };
    const controls = el("span");
    controls.style.display = "contents";
    controls.append(
      btn("Newer posts", () => {
        log("sending a page of newer posts (the store should park them as pending)");
        sendResp(op, "https://x.com/i/api/graphql/HARNESS/" + op + "?variables=%7B%7D", F.newerPage(op));
      }, "Posts newer than everything loaded: the N new posts pill should appear"),
      btn("Back", () => history.back(), "Real history.back(): a popstate"),
      btn("Forward", () => history.forward(), "Real history.forward(): a popstate"),
      btn("Click parent in X", () => {
        // The nearest earlier visited status page that isn't the one showing now.
        let prev = null;
        for (let i = pos - 1; i >= 0 && !prev; i--) {
          const m = ROUTE_RE.exec(stack[i]);
          if (m && m[2] !== statusId(routeNow())) prev = "/" + m[1] + "/status/" + m[2];
        }
        if (!prev) return log("Click parent in X: no earlier status page in the history");
        push(prev);
        log("X pushed an earlier visited path itself ->", routeNow(), "(no popstate, like X)");
        renderFake();
      }, "X pushes an earlier visited status path with no popstate, like clicking the parent post in X"),
      btn("Photo subpath", () => {
        if (!statusId(routeNow())) return log("Photo subpath: only on a status page");
        push(routeNow().replace(/\/photo\/\d+$/, "") + "/photo/1");
        log("X pushed its own entry ->", routeNow(), "(no popstate, like X)");
        renderFake();
      }, "Push <current>/photo/1 without popstate, like X opening a photo"),
      btn("Op: For you", (b) => {
        op = op === "HomeTimeline" ? "HomeLatestTimeline" : "HomeTimeline";
        b.textContent = "Op: " + (op === "HomeTimeline" ? "For you" : "Following");
        nextPage = 2;
        homeInFlight = false;
        sendHome(1);
      }, "Switch between For you and Following: the grid resets"),
      btn("Theme: " + theme, (b) => {
        theme = theme === "dark" ? "dim" : theme === "dim" ? "light" : "dark";
        try {
          localStorage.setItem("xg-harness:theme", theme);
        } catch {}
        applyBodyTheme();
        b.textContent = "Theme: " + theme;
        if (XG.app) XG.app.overlay.refreshTheme();
      }, "Cycle dark / dim / light"),
      check("Stall paging", "stallPaging", "Scrolling X to the bottom loads nothing: exercises nudges, then Retry"),
      check("Break X buttons", "breakButtons", "Like and repost buttons do nothing: exercises the toast"),
      check("Ignore navigate", "ignoreNavigate", "X's router ignores navigate commands: exercises the never-arrived path"),
      btn("Land late", landLate, "Deliver the oldest ignored navigate now, as if X's router got to it late"),
      check("Stall threads", "stallThreads", "navigate never produces a TweetDetail: exercises the 8 s message"),
      btn("Reset storage", () => {
        try {
          localStorage.removeItem("xg-harness:storage");
        } catch {}
        location.reload();
      }, "Forget saved settings and reload")
    );
    statusEl = el("span", "st");
    errEl = el("span", "err");
    errEl.hidden = true;
    const toggle = btn("Debug", () => {
      controls.style.display = controls.style.display === "none" ? "contents" : "none";
    }, "Collapse or expand this bar");
    bar.append(toggle, controls, statusEl, errEl);
    document.body.appendChild(bar);
    setInterval(() => {
      const s = XG.app && XG.app.store;
      const v = view();
      statusEl.textContent =
        "route " + v.route + " [" + (pos + 1) + "/" + stack.length + "]  |  " + (s ? s.size + " posts" : "not mounted") +
        "  |  drawer " + (v.drawerOpen ? v.focal : "closed") + "  |  overlay " + (v.overlay ? "up" : "hidden") + "  |  pill " + (v.pill ? "shown" : "hidden") +
        (droppedNavs.length ? "  |  " + droppedNavs.length + " ignored navigate(s)" : "");
    }, 500);
  }

  const showError = (msg) => {
    errCount++;
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = errCount + " error" + (errCount > 1 ? "s" : "") + ": see console (" + msg + ")";
    }
  };
  window.addEventListener("error", (e) => showError(String(e.message || "error").slice(0, 60)));
  window.addEventListener("unhandledrejection", (e) => showError(String((e.reason && e.reason.message) || e.reason).slice(0, 60)));

  // What a person would see: the route, the drawer, the overlay and the pill.
  function view() {
    const app = XG.app;
    const pillEl = app && app.overlay.shadow.querySelector(".xg-pill");
    return {
      route: routeNow(),
      drawerOpen: !!(app && app.drawer.isOpen),
      focal: app && app.drawer.isOpen ? app.drawer.focalId : null,
      overlay: !!(app && app.overlay.visible),
      pill: !!(pillEl && !pillEl.hidden),
      inflight: app ? app.inflight() : null,
    };
  }

  XG.harness = { history: () => ({ stack: stack.slice(), pos, route: routeNow() }), view, dbg, landLate, dropped: () => droppedNavs.slice() };

  // ---- boot ----------------------------------------------------------------------------------------
  window.addEventListener("load", () => {
    buildBar();
    renderFake();
    // content.js registered its message listener when it loaded, and buffers until mounted.
    setTimeout(() => sendHome(1), 60);
    log("harness ready. Gallery overlay should appear over the fake X page.");
  });
})();
