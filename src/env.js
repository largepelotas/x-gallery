// Seams the dev harness replaces (dev/harness.js sets XG.env before content.js runs).
// Everything here touches the page, so nothing runs at load: all lazy, inside functions.
(() => {
  const XG = (globalThis.XG ??= {});

  XG.env = {
    route: () => location.pathname,
    scrollPageToBottom: () => window.scrollTo(0, document.documentElement.scrollHeight),
    scrollPageBy: (dy) => window.scrollBy(0, dy),
    viewerId: () => /(?:^|;\s*)twid=u%3D(\d+)/.exec(document.cookie)?.[1] ?? null,
    pageTheme: () => {
      const el = document.body || document.documentElement;
      const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(getComputedStyle(el).backgroundColor);
      if (!m) return "dark";
      const [r, g, b] = [m[1], m[2], m[3]].map(Number);
      if (r === 255 && g === 255 && b === 255) return "light";
      if (r === 21 && g === 32 && b === 43) return "dim";
      return "dark";
    },
  };
})();
