// Column layout. N flex columns; each card goes to the currently shortest one.
// Card heights are measured once per column width and cached, so a relayout
// (filter, column count, resize) only moves existing elements and never
// re-renders them: loaded images and GIF state survive.
(() => {
  const XG = (globalThis.XG ??= {});

  const clampCols = (n) => Math.max(1, Math.min(8, Math.round(Number(n)) || 4));

  XG.createMasonry = function createMasonry(gridEl, opts = {}) {
    const gap = opts.gap ?? 8;
    const scroller = opts.scroller || null; // optional: keeps the reading position across rebuilds
    let n = clampCols(opts.columns);
    let items = [];
    let itemSet = new Set();
    let cols = [];
    let heights = [];
    let colW = 0; // column width the current layout was measured at; 0 = grid not laid out (hidden)
    let seenHidden = false;
    let timer = 0;
    const cache = new WeakMap(); // card el -> { w, h }

    gridEl.style.display = "flex";
    gridEl.style.gap = gap + "px";
    gridEl.style.alignItems = "flex-start";

    const measureColWidth = () => (cols[0] ? cols[0].getBoundingClientRect().width : 0);

    function makeCols() {
      for (const c of cols) c.remove();
      cols = [];
      for (let i = 0; i < n; i++) {
        const c = document.createElement("div");
        c.className = "xg-col";
        c.style.display = "flex";
        c.style.flexDirection = "column";
        c.style.gap = gap + "px";
        c.style.flex = "1 1 0";
        c.style.minWidth = "0";
        gridEl.appendChild(c);
        cols.push(c);
      }
      heights = new Array(n).fill(0);
    }

    // Exact height of a card at the current width. content-visibility:auto would
    // otherwise report the intrinsic-size estimate for off-screen cards.
    function measure(el) {
      const prev = el.style.contentVisibility;
      el.style.contentVisibility = "visible";
      const h = el.getBoundingClientRect().height;
      el.style.contentVisibility = prev;
      // Keep the skipped-render placeholder equal to the truth: no scroll jumps later.
      el.style.setProperty("--xg-est", Math.round(h) + "px");
      return h;
    }

    const estimate = (el) => parseFloat(el.style.getPropertyValue("--xg-est")) || 300;

    function place(el) {
      let idx = 0;
      for (let i = 1; i < n; i++) if (heights[i] < heights[idx] - 0.5) idx = i;
      cols[idx].appendChild(el);
      let h;
      if (colW > 0) {
        const hit = cache.get(el);
        if (hit && Math.abs(hit.w - colW) < 0.5) h = hit.h;
        else {
          h = measure(el);
          cache.set(el, { w: colW, h });
        }
      } else {
        h = estimate(el); // not laid out yet: place by estimate, never cache it
      }
      heights[idx] += h + gap;
    }

    function rebuild() {
      const st = scroller ? scroller.scrollTop : 0;
      const sh = scroller ? scroller.scrollHeight : 0;
      if (cols.length !== n) makeCols();
      for (const c of cols) c.replaceChildren();
      heights = new Array(n).fill(0);
      colW = measureColWidth();
      for (const el of items) place(el);
      if (scroller && st > 0 && sh > 0) scroller.scrollTop = (st * scroller.scrollHeight) / sh;
    }

    function append(els) {
      const fresh = [];
      for (const el of els || []) {
        if (itemSet.has(el)) continue;
        itemSet.add(el);
        items.push(el);
        fresh.push(el);
      }
      if (!fresh.length) return;
      colW = measureColWidth();
      for (const el of fresh) place(el);
    }

    function relayout(els) {
      items = Array.from(els || []);
      itemSet = new Set(items);
      rebuild();
    }

    function setColumns(next) {
      const c = clampCols(next);
      if (c === n) return;
      n = c;
      rebuild();
    }

    function clear() {
      items = [];
      itemSet = new Set();
      for (const c of cols) c.replaceChildren();
      heights = new Array(n).fill(0);
    }

    // Width changes: debounced 150 ms, except the first layout after the grid
    // was hidden (the overlay just appeared; nothing to wait for).
    const ro = new ResizeObserver(() => {
      const w = measureColWidth();
      if (w <= 0) {
        seenHidden = true;
        return;
      }
      if (!seenHidden && Math.abs(w - colW) < 0.5) return;
      const immediate = seenHidden || colW === 0;
      seenHidden = false;
      clearTimeout(timer);
      if (immediate) rebuild();
      else timer = setTimeout(rebuild, 150);
    });

    makeCols();
    ro.observe(gridEl);

    return {
      setColumns,
      append,
      relayout,
      clear,
      colWidth: () => colW || measureColWidth(),
      destroy() {
        clearTimeout(timer);
        ro.disconnect();
      },
    };
  };
})();
