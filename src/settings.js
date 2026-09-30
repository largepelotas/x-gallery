// XG.settings: the only persisted state, in chrome.storage.local under "xg:settings".
// Never rejects: a storage failure yields defaults, and the UI carries on.
(() => {
  const XG = (globalThis.XG ??= {});
  const KEY = "xg:settings";
  const FILTER_KEYS = ["hideReplies", "hideReposts", "mediaOnly", "followingOnly"];

  const defaults = () => ({
    columns: 4,
    filters: { hideReplies: false, hideReposts: false, mediaOnly: false, followingOnly: false },
    enabled: true,
  });

  // Anything malformed or out of range falls back to its default.
  function sanitize(raw) {
    const out = defaults();
    if (!raw || typeof raw !== "object") return out;
    if (raw.columns === 3 || raw.columns === 4 || raw.columns === 5) out.columns = raw.columns;
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    if (raw.filters && typeof raw.filters === "object") {
      for (const k of FILTER_KEYS) if (typeof raw.filters[k] === "boolean") out.filters[k] = raw.filters[k];
    }
    return out;
  }

  // Works with the callback form and the promise form, so the in-memory harness
  // shim may implement either.
  function call(method, arg) {
    return new Promise((resolve) => {
      try {
        const done = (v) => {
          try {
            void chrome.runtime.lastError;
          } catch {}
          resolve(v && typeof v === "object" ? v : {});
        };
        const p = chrome.storage.local[method](arg, done);
        if (p && typeof p.then === "function") p.then(done, () => resolve({}));
      } catch {
        resolve({});
      }
    });
  }

  const load = () => call("get", KEY).then((r) => sanitize(r[KEY]));

  // Saves are serialized: two quick clicks (a chip, then a column) must not
  // both read the same old value and drop one write.
  let queue = Promise.resolve();
  function save(partial) {
    const p = partial && typeof partial === "object" ? partial : {};
    const run = async () => {
      const cur = await load();
      const next = sanitize({
        columns: p.columns ?? cur.columns,
        enabled: p.enabled ?? cur.enabled,
        filters: { ...cur.filters, ...(p.filters && typeof p.filters === "object" ? p.filters : {}) },
      });
      await call("set", { [KEY]: next });
      return next;
    };
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }

  XG.settings = { load, save };
})();
