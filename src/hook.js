// MAIN world. Taps X's own GraphQL responses and relays them to the extension,
// and runs the "navigate" command. Read-only by contract (CLAUDE.md invariant 3):
// it never delays, alters, or throws into anything the page sees.
(() => {
  if (window.__xgHook) return;
  window.__xgHook = true;

  const RE = /\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline|TweetDetail)(?:\?|$)/;

  const match = (u) => {
    try {
      const abs = new URL(u, location.href).href;
      const m = RE.exec(abs);
      return m ? { op: m[1], url: abs } : null;
    } catch {
      return null;
    }
  };

  const send = (m, body) => {
    try {
      if (typeof body === "string" && body) {
        window.postMessage({ __xg: "resp", op: m.op, url: m.url, body }, location.origin);
      }
    } catch {}
  };

  // fetch: our branch hangs off a clone. The page gets the original promise.
  const origFetch = window.fetch;
  window.fetch = function () {
    const p = origFetch.apply(this, arguments);
    try {
      const a = arguments[0];
      const m = match(typeof a === "string" || a instanceof URL ? String(a) : a && a.url);
      if (m) {
        p.then((res) => (res.ok ? res.clone().text() : null))
          .then((text) => send(m, text))
          .catch(() => {});
      }
    } catch {}
    return p;
  };

  // XHR: remember the URL at open(); attach ONE load listener per instance at send().
  // The listener reads the URL at load time, so a reused XHR never piles up stale listeners.
  const urls = new WeakMap();
  const listening = new WeakSet();
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      urls.set(this, url);
    } catch {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      if (!listening.has(this) && match(urls.get(this))) {
        listening.add(this);
        this.addEventListener("load", () => {
          try {
            const m = match(urls.get(this));
            if (!m || this.status !== 200) return;
            const t = this.responseType;
            send(m, t === "json" ? JSON.stringify(this.response) : t === "" || t === "text" ? this.responseText : null);
          } catch {}
        });
      }
    } catch {}
    return origSend.apply(this, arguments);
  };

  // navigate: click X's own link if it is in the DOM, else drive its router.
  window.addEventListener("message", (e) => {
    try {
      const d = e.data;
      if (e.source !== window || !d || d.__xg !== "cmd" || d.cmd !== "navigate") return;
      if (typeof d.path !== "string" || !/^\/(?!\/)/.test(d.path)) return;
      const want = d.path.toLowerCase();
      const a = Array.from(document.querySelectorAll("a[href]")).find((el) => String(el.pathname || "").toLowerCase() === want);
      if (a) return a.click();
      history.pushState(null, "", d.path);
      dispatchEvent(new PopStateEvent("popstate", { state: null }));
    } catch {}
  });
})();
