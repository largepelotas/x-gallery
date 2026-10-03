// Our own simple stroke icons. Static strings only: the one place innerHTML is
// allowed (CLAUDE.md invariant 4). No post data ever goes through here.
(() => {
  const XG = (globalThis.XG ??= {});

  const svg = (body) =>
    '<svg class="xg-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    body +
    "</svg>";

  const icons = {
    // `xg-fill` is filled with currentColor by CSS when the post is liked.
    heart: svg('<path class="xg-fill" d="M12 20.2C6.2 16.3 3.5 13 3.5 9.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8.5 1.8c0 3.6-2.7 6.9-8.5 10.8z"/>'),
    repost: svg('<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H18"/><path d="M15 4l3 3-3 3"/><path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6"/><path d="M9 20l-3-3 3-3"/>'),
    reply: svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 4v-4H5.5A1.5 1.5 0 0 1 4 14.5z"/>'),
    replyArrow: svg('<path d="M9.5 6L4.5 11l5 5"/><path d="M4.5 11H13a6.5 6.5 0 0 1 6.5 6.5V19"/>'),
    chart: svg('<path d="M5 20v-8"/><path d="M12 20V5"/><path d="M19 20V9"/>'),
    close: svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
    grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'),
    external: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
    chevronLeft: svg('<path d="M14.5 6l-6 6 6 6"/>'),
    chevronRight: svg('<path d="M9.5 6l6 6-6 6"/>'),
    arrowUp: svg('<path d="M12 19V6"/><path d="M6.5 11.5L12 6l5.5 5.5"/>'),
    verified: svg('<path d="M12 3l2.3 1.7 2.8-.1 1 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-1 2.7-2.8-.1L12 21l-2.3-1.7-2.8.1-1-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6 1-2.7 2.8.1z" fill="currentColor" stroke="none"/><path d="M8.3 12.2l2.5 2.5 4.9-5" stroke="#fff" stroke-width="2"/>'),
    refresh: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  };

  // A span holding one of the icons above.
  icons.el = (name, cls) => {
    const s = document.createElement("span");
    s.className = "xg-icon" + (cls ? " " + cls : "");
    s.innerHTML = icons[name] || ""; // static string from this file
    return s;
  };

  XG.icons = icons;
})();
