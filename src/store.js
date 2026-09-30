// XG.createStore: the posts we hold, their display order, filters, and the
// "newer posts" pending queue. Pure: no DOM, no chrome.*, no timers.
(() => {
  const XG = (globalThis.XG ??= {});
  const FILTER_KEYS = ["hideReplies", "hideReposts", "mediaOnly", "followingOnly"];

  // sortIndex is a 19-digit string, beyond Number precision. Anything that is
  // not all digits (including null) is "unknown" and never counts as newer.
  const big = (s) => (typeof s === "string" && /^\d+$/.test(s) ? BigInt(s) : null);

  XG.createStore = function createStore(opts) {
    const viewerId = opts && opts.viewerId != null ? opts.viewerId : null;
    const filters = { hideReplies: false, hideReposts: false, mediaOnly: false, followingOnly: false };
    let op = null;
    let order = []; // Post[] in display order
    let pending = []; // Post[] newer than everything in `order`, top first
    let maxSort = null; // highest known sortIndex in `order`, as BigInt
    const byId = new Map(); // order + pending

    const bump = (p) => {
      const s = big(p.sortIndex);
      if (s !== null && (maxSort === null || s > maxSort)) maxSort = s;
    };

    // Same post seen again: the counts and the viewer's own state move, the rest stays.
    const refresh = (known, p) => {
      if (known === p) return;
      if (p.metrics) known.metrics = { ...p.metrics };
      known.liked = !!p.liked;
      known.reposted = !!p.reposted;
    };

    function passes(p) {
      if (filters.hideReplies && p.isReply) return false;
      if (filters.hideReposts && p.repostedBy != null) return false;
      if (filters.mediaOnly && !(p.media && p.media.length)) return false;
      // following === null (unknown) passes on purpose: if X renames the field, a
      // filter that hid unknowns would silently empty the grid.
      if (filters.followingOnly && p.author && p.author.following === false && p.author.id !== viewerId) return false;
      return true;
    }

    function ingestTimeline(newOp, parsed) {
      let reset = false;
      if (newOp !== op) {
        op = newOp;
        order = [];
        pending = [];
        maxSort = null;
        byId.clear();
        reset = true;
      }
      const updated = [];
      const fresh = [];
      const seen = new Set();
      for (const p of Array.isArray(parsed && parsed.posts) ? parsed.posts : []) {
        if (!p || typeof p.id !== "string" || seen.has(p.id)) continue;
        seen.add(p.id);
        const known = byId.get(p.id);
        if (known) {
          refresh(known, p);
          updated.push(p.id);
        } else fresh.push(p);
      }

      // A batch whose every post is newer than everything we hold is a refresh from
      // the top, so it waits behind the "N new posts" pill instead of shifting the grid.
      const newer =
        fresh.length > 0 &&
        order.length > 0 &&
        maxSort !== null &&
        fresh.every((p) => {
          const s = big(p.sortIndex);
          return s !== null && s > maxSort;
        });
      for (const p of fresh) byId.set(p.id, p);
      if (newer) pending = fresh.concat(pending);
      else
        for (const p of fresh) {
          order.push(p);
          bump(p);
        }
      return { reset, appended: newer ? [] : fresh, pendingCount: pending.length, updated };
    }

    function ingestDetail(parsed) {
      const updated = [];
      const seen = new Set();
      const visit = (p) => {
        if (!p || seen.has(p.id)) return;
        seen.add(p.id);
        const known = byId.get(p.id);
        if (!known) return;
        refresh(known, p);
        updated.push(p.id);
      };
      for (const it of (parsed && parsed.items) || []) {
        if (!it) continue;
        if (it.kind === "post") visit(it.post);
        else if (it.kind === "module") (it.posts || []).forEach(visit);
      }
      for (const m of (parsed && parsed.moduleAdds) || []) ((m && m.posts) || []).forEach(visit);
      return { updated };
    }

    function flushPending() {
      const flushed = pending;
      pending = [];
      order = flushed.concat(order);
      flushed.forEach(bump);
      return flushed.slice();
    }

    function setPostState(id, state) {
      const p = byId.get(id);
      if (!p) return undefined;
      const m = (p.metrics = p.metrics || {});
      if (state && typeof state.liked === "boolean" && state.liked !== !!p.liked) {
        p.liked = state.liked;
        m.likes = Math.max(0, (m.likes || 0) + (state.liked ? 1 : -1));
      }
      if (state && typeof state.reposted === "boolean" && state.reposted !== !!p.reposted) {
        p.reposted = state.reposted;
        m.reposts = Math.max(0, (m.reposts || 0) + (state.reposted ? 1 : -1));
      }
      return p;
    }

    return {
      get op() {
        return op;
      },
      get size() {
        return order.length;
      },
      get filters() {
        return { ...filters };
      },
      setFilters(partial) {
        for (const k of FILTER_KEYS) if (partial && partial[k] !== undefined) filters[k] = !!partial[k];
      },
      passes,
      ingestTimeline,
      ingestDetail,
      flushPending,
      list: () => order.slice(),
      visible: () => order.filter(passes),
      get: (id) => byId.get(id),
      setPostState,
    };
  };

  if (typeof module !== "undefined") module.exports = XG.createStore;
})();
