// The only file that knows X's DOM test ids. Like and repost happen by clicking
// X's own buttons; we never send the mutation ourselves (CLAUDE.md invariant 2).
(() => {
  const XG = (globalThis.XG ??= {});

  const ARTICLE = 'article[data-testid="tweet"]';
  const POLL_MS = 100;

  // Poll `pred` every 100 ms until it is truthy or `ms` elapses.
  function waitFor(pred, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let v = null;
        try { v = pred(); } catch { v = null; }
        if (v) return resolve(v);
        if (Date.now() - t0 >= ms) return resolve(null);
        setTimeout(tick, POLL_MS);
      };
      tick();
    });
  }

  // An article's own permalink is the first status link that wraps a <time>
  // and is not inside a quoted post. A quote card is an element with
  // role="link" strictly between the anchor and the article.
  function ownPermalink(article) {
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      if (!a.querySelector("time")) continue;
      let quoted = false;
      for (let p = a.parentElement; p && p !== article; p = p.parentElement) {
        if (p.getAttribute("role") === "link") { quoted = true; break; }
      }
      if (!quoted) return a.getAttribute("href") || "";
    }
    return "";
  }

  function findArticle(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const re = new RegExp("/status/" + id + "(?:[/?#]|$)");
    for (const article of document.querySelectorAll(ARTICLE)) {
      if (re.test(ownPermalink(article))) return article;
    }
    return null;
  }

  // Current liked state of the article for `id`, or null if it or its button
  // is missing.
  function likedState(id) {
    const a = findArticle(id);
    if (!a) return null;
    if (a.querySelector('[data-testid="unlike"]')) return true;
    if (a.querySelector('[data-testid="like"]')) return false;
    return null;
  }

  function repostedState(id) {
    const a = findArticle(id);
    if (!a) return null;
    if (a.querySelector('[data-testid="unretweet"]')) return true;
    if (a.querySelector('[data-testid="retweet"]')) return false;
    return null;
  }

  async function setLiked(id, want) {
    const article = findArticle(id);
    const btn = article && article.querySelector('[data-testid="like"], [data-testid="unlike"]');
    if (!btn) return null;
    const now = likedState(id);
    if (now === want) return want;
    btn.click();
    await waitFor(() => likedState(id) === want, 3000);
    return likedState(id);
  }

  async function setReposted(id, want) {
    const article = findArticle(id);
    const btn = article && article.querySelector('[data-testid="retweet"], [data-testid="unretweet"]');
    if (!btn) return null;
    if (repostedState(id) === want) return want;
    btn.click();
    const confirm = await waitFor(
      () => document.querySelector('[data-testid="retweetConfirm"], [data-testid="unretweetConfirm"]'),
      2000
    );
    if (!confirm) {
      // Close whatever menu did open. Dispatched on the menu (or the focused element),
      // never on document: that sits above React's root listener, so X wouldn't see it.
      // Synthetic, so the overlay's own key handler ignores it.
      const target = document.querySelector('[role="menu"]') || document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return null;
    }
    confirm.click();
    await waitFor(() => repostedState(id) === want, 3000);
    return repostedState(id);
  }

  XG.native = { findArticle, setLiked, setReposted };
})();
