// CSS text for the shadow root. Applied by overlay.js through a constructable
// stylesheet (CSSOM), so X's CSP never sees it. Tokens are per theme on :host;
// overlay.js sets data-theme on the host element.
(() => {
  const XG = (globalThis.XG ??= {});

  const css = String.raw`
:host{all:initial;display:block;
  --bg:#000;--card:#16181c;--border:#2f3336;--border-hi:#536471;--text:#e7e9ea;--muted:#71767b;
  --accent:#1d9bf0;--like:#f91880;--repost:#00ba7c;
  --hover:rgba(231,233,234,.08);--seg-on:#2f3336;--skel:#0f1113;--bar:rgba(0,0,0,.78);
  --chip-on:#1d9bf0;--chip-on-text:#fff;
  --shadow:0 12px 40px rgba(0,0,0,.6);--drawer-shadow:-18px 0 40px rgba(0,0,0,.5);
  --scrim:rgba(0,0,0,.92);--focus:#1d9bf0;
  color-scheme:dark}
:host([data-theme="dim"]){
  --bg:#15202b;--card:#1e2732;--border:#38444d;--border-hi:#66788a;--text:#f7f9f9;--muted:#8b98a5;
  --hover:rgba(247,249,249,.08);--seg-on:#38444d;--skel:#182430;--bar:rgba(21,32,43,.8);
  --drawer-shadow:-18px 0 40px rgba(0,0,0,.4);--scrim:rgba(4,9,14,.92)}
:host([data-theme="light"]){
  --bg:#fff;--card:#f7f9f9;--border:#cfd9de;--border-hi:#8b98a5;--text:#0f1419;--muted:#536471;
  --hover:rgba(15,20,25,.06);--seg-on:#e7ecef;--skel:#e7ecef;--bar:rgba(255,255,255,.82);
  --shadow:0 12px 40px rgba(15,20,25,.22);--drawer-shadow:-18px 0 40px rgba(15,20,25,.14);
  --scrim:rgba(0,0,0,.88);color-scheme:light}

*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
button{font:inherit;color:inherit;margin:0;-webkit-tap-highlight-color:transparent}
a{color:inherit}
img,video{max-width:100%}
:where(button,a,[tabindex]):focus-visible{outline:2px solid var(--focus);outline-offset:2px}
:where(button,a,[tabindex]):focus:not(:focus-visible){outline:none}

.xg-ic{display:block;width:18px;height:18px}
.xg-icon{display:inline-flex;flex:none;line-height:0}
.xg-fill{transition:fill .15s}

/* ---- shell -------------------------------------------------------------- */
.xg-root{position:absolute;inset:0;pointer-events:auto;overflow:hidden;background:var(--bg);color:var(--text);
  font:13px/1.35 TwitterChirp,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.xg-scroller{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;
  scrollbar-color:var(--border) transparent}

/* ---- toolbar ------------------------------------------------------------ */
.xg-toolbar{position:sticky;top:0;z-index:5;height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;
  background:var(--bar);-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4);
  border-bottom:1px solid var(--border)}
.xg-title{flex:none;display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;letter-spacing:-.01em}
.xg-title .xg-icon{color:var(--accent)}
.xg-source{flex:none;font-size:12px;font-weight:600;color:var(--muted);padding:3px 10px;border:1px solid var(--border);
  border-radius:999px;white-space:nowrap}
.xg-chips{flex:1 1 auto;min-width:0;display:flex;gap:6px;overflow-x:auto;padding:3px;scrollbar-width:none}
.xg-chips::-webkit-scrollbar{display:none}
.xg-chip{flex:none;height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--border);background:transparent;
  color:var(--text);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
  transition:background-color .15s,border-color .15s,color .15s}
.xg-chip:hover{background:var(--hover);border-color:var(--border-hi)}
.xg-chip[aria-pressed="true"]{background:var(--chip-on);border-color:var(--chip-on);color:var(--chip-on-text)}
.xg-chip[aria-pressed="true"]:hover{filter:brightness(1.08)}
.xg-chip:focus-visible{outline-offset:1px}
.xg-seg{flex:none;display:flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:999px}
.xg-seg button{width:30px;height:22px;border:0;border-radius:999px;background:transparent;color:var(--muted);
  font-size:12px;font-weight:700;cursor:pointer;transition:background-color .15s,color .15s}
.xg-seg button:hover{color:var(--text)}
.xg-seg button[aria-pressed="true"]{background:var(--seg-on);color:var(--text);box-shadow:inset 0 0 0 1px var(--border-hi)}
.xg-count{flex:none;min-width:60px;text-align:right;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;
  white-space:nowrap}
.xg-iconbtn{flex:none;width:32px;height:32px;display:inline-grid;place-items:center;border:0;border-radius:50%;
  background:transparent;color:var(--text);cursor:pointer;text-decoration:none;transition:background-color .15s}
.xg-iconbtn:hover{background:var(--hover)}
@media (max-width:860px){.xg-title span.xg-label,.xg-source{display:none}}

/* ---- grid, footer, states ---------------------------------------------- */
.xg-grid{padding:10px 12px 0;max-width:2200px;margin:0 auto}
.xg-empty{padding:22vh 24px 0;text-align:center;color:var(--muted);font-size:15px}
.xg-footer{position:relative;display:flex;justify-content:center;align-items:flex-start;min-height:96px;padding:22px 0 48px}
.xg-sentinel{position:absolute;left:0;right:0;top:0;height:1px;pointer-events:none}
.xg-status{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px}
.xg-spin{width:16px;height:16px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--accent);
  animation:xg-spin .8s linear infinite}
.xg-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 13px;border-radius:999px;
  border:1px solid var(--border-hi);background:transparent;color:var(--text);font-size:12px;font-weight:700;
  cursor:pointer;text-decoration:none;white-space:nowrap;transition:background-color .15s}
.xg-btn:hover{background:var(--hover)}
.xg-btn .xg-ic{width:15px;height:15px}
.xg-newpill{position:sticky;top:52px;z-index:6;height:0;display:flex;justify-content:center;pointer-events:none}
.xg-newbtn{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 15px 0 11px;
  border:0;border-radius:999px;background:var(--accent);color:#fff;font-size:13px;font-weight:700;cursor:pointer;
  box-shadow:0 8px 22px rgba(29,155,240,.42);animation:xg-drop .22s ease-out}
.xg-newbtn:hover{filter:brightness(1.08)}
.xg-newbtn .xg-ic{width:15px;height:15px;stroke-width:2.4}
.xg-pill{position:absolute;right:20px;bottom:160px;pointer-events:auto;display:inline-flex;align-items:center;gap:8px;
  height:40px;padding:0 16px 0 12px;border-radius:999px;border:1px solid var(--border-hi);background:var(--bg);
  color:var(--text);font:700 13px/1 TwitterChirp,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  box-shadow:var(--shadow);cursor:pointer;transition:border-color .15s,background-color .15s}
.xg-pill:hover{border-color:var(--accent);background:var(--card)}
.xg-pill .xg-icon{color:var(--accent)}

/* ---- grid card ---------------------------------------------------------- */
.xg-card{position:relative;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border);
  border-radius:12px;overflow:hidden;cursor:pointer;content-visibility:auto;
  contain-intrinsic-block-size:auto var(--xg-est,320px);transition:border-color .15s}
.xg-card:hover{border-color:var(--border-hi)}
.xg-card{container-type:inline-size}
@container (max-width:200px){
  .xg-metrics{gap:10px}
  .xg-mt.xg-views{display:none}
}
.xg-media{position:relative;overflow:hidden;background:var(--skel)}
.xg-m1{width:100%}
.xg-m1>.xg-cell{position:absolute;inset:0}
.xg-mgrid{display:grid;grid-template-columns:1fr 1fr;gap:2px}
.xg-mgrid .xg-cell{aspect-ratio:1}
.xg-m3>.xg-cell:first-child{grid-column:1/-1;aspect-ratio:2/1}
.xg-cell{position:relative;min-width:0;overflow:hidden;background:var(--skel)}
.xg-img{display:block;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .22s}
.xg-img.xg-loaded{opacity:1}
.xg-vid{display:block;width:100%;height:100%;object-fit:cover;background:transparent}
.xg-badge{position:absolute;bottom:6px;padding:0 6px;border-radius:5px;background:rgba(0,0,0,.72);color:#fff;
  font-size:11px;font-weight:700;line-height:17px;letter-spacing:.02em;font-variant-numeric:tabular-nums;pointer-events:none}
.xg-badge.xg-r{right:6px}
.xg-badge.xg-l{left:6px}

.xg-body{display:flex;flex-direction:column;gap:6px;padding:8px 10px 9px;min-width:0}
.xg-repostline{display:flex;align-items:center;gap:5px;font-size:11px;line-height:14px;color:var(--muted);font-weight:600;
  min-width:0}
.xg-repostline .xg-ic{width:12px;height:12px}
.xg-repostline span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xg-meta{display:flex;align-items:center;gap:6px;min-width:0;line-height:20px;font-size:12px}
.xg-av{flex:none;width:20px;height:20px;border-radius:50%;background:var(--border);object-fit:cover}
.xg-name{flex:0 1 auto;min-width:0;max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-weight:700;color:var(--text)}
.xg-vbadge{flex:none;display:inline-flex;color:var(--accent);margin-left:-2px}
.xg-vbadge .xg-ic{width:14px;height:14px}
.xg-handle{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.xg-time{flex:none;color:var(--muted);white-space:nowrap}
.xg-replyglyph{flex:none;color:var(--muted)}
.xg-replyglyph .xg-ic{width:13px;height:13px}
.xg-text{font-size:13px;line-height:1.35;overflow-wrap:anywhere;white-space:pre-wrap;display:-webkit-box;
  -webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.xg-textonly .xg-text{font-size:14px;-webkit-line-clamp:8}
.xg-a{color:var(--accent)}
a.xg-a{text-decoration:none}
a.xg-a:hover{text-decoration:underline}
.xg-quote{display:flex;gap:8px;align-items:flex-start;padding:7px 8px;border:1px solid var(--border);border-radius:10px;
  min-width:0;transition:border-color .15s,background-color .15s}
.xg-card .xg-quote:hover{border-color:var(--border-hi)}
.xg-q-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.xg-q-head{display:flex;align-items:center;gap:5px;min-width:0;font-size:12px;line-height:16px}
.xg-q-head .xg-av{width:16px;height:16px}
.xg-q-text{font-size:12px;line-height:1.3;color:var(--text);overflow-wrap:anywhere;display:-webkit-box;
  -webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.xg-q-thumb{flex:none;width:48px;height:48px;border-radius:7px;object-fit:cover;background:var(--skel)}
.xg-metrics{display:flex;align-items:center;gap:14px;font-size:11px;line-height:14px;color:var(--muted);
  font-variant-numeric:tabular-nums}
.xg-mt{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.xg-mt .xg-ic{width:13px;height:13px}
.xg-mt.xg-views{margin-left:auto}
.xg-mt.xg-liked,.xg-act.xg-liked{color:var(--like)}
.xg-mt.xg-reposted,.xg-act.xg-reposted{color:var(--repost)}
.xg-liked .xg-fill{fill:currentColor}
.xg-reposted .xg-ic{stroke-width:2.4}

/* ---- drawer ------------------------------------------------------------- */
.xg-drawer{position:absolute;top:0;right:0;bottom:0;z-index:20;width:clamp(420px,36vw,640px);max-width:100%;
  display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--border);
  box-shadow:var(--drawer-shadow);transform:translateX(100%);visibility:hidden;
  transition:transform .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}
.xg-drawer.xg-open{transform:none;visibility:visible;transition:transform .22s cubic-bezier(.2,.8,.2,1),visibility 0s}
.xg-drawer:focus{outline:none}
.xg-dhead{flex:none;height:44px;display:flex;align-items:center;gap:6px;padding:0 8px 0 16px;
  border-bottom:1px solid var(--border);background:var(--bar);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.xg-dhead h2{flex:1;margin:0;font-size:15px;font-weight:800}
.xg-dbody{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;
  scrollbar-color:var(--border) transparent}
.xg-dfoot{display:flex;justify-content:center;padding:18px 0 40px;min-height:60px}
.xg-dsentinel{height:1px}
.xg-tstatus{display:flex;align-items:center;justify-content:center;gap:10px;padding:22px 16px;color:var(--muted);
  font-size:13px;border-top:1px solid var(--border)}
.xg-group{border-bottom:1px solid var(--border)}
.xg-tp{position:relative;display:flex;gap:10px;padding:0 16px;cursor:pointer;transition:background-color .12s}
.xg-tp:hover{background:var(--hover)}
.xg-tp-side{flex:none;width:32px;display:flex;flex-direction:column;align-items:center;padding-top:10px}
.xg-tp-side .xg-av{width:32px;height:32px}
.xg-tp-line{display:none;flex:1;width:2px;margin-top:4px;border-radius:1px;background:var(--border)}
.xg-tp:not(:last-child) .xg-tp-line,.xg-anc .xg-tp:last-child .xg-tp-line{display:block}
.xg-tp-main{flex:1;min-width:0;padding:10px 0 6px}
.xg-tp .xg-meta{font-size:14px;line-height:20px}
.xg-tp-text{margin-top:2px;font-size:14px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}
.xg-tp .xg-media{margin-top:8px;border-radius:12px;border:1px solid var(--border)}
.xg-tp .xg-quote{margin-top:8px}
.xg-tp .xg-q-text{color:var(--muted)}
.xg-acts{display:flex;align-items:center;gap:6px;margin:4px 0 0 -8px}
.xg-act{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:999px;
  background:transparent;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer;
  transition:background-color .15s,color .15s}
.xg-act .xg-ic{width:16px;height:16px}
.xg-act.xg-static{cursor:default}
.xg-act[data-kind="like"]:hover{color:var(--like);background:rgba(249,24,128,.1)}
.xg-act[data-kind="repost"]:hover{color:var(--repost);background:rgba(0,186,124,.1)}
.xg-act[disabled]{opacity:.55;cursor:progress}
.xg-fp{padding:14px 16px 0}
.xg-fp-head{display:flex;align-items:center;gap:10px}
.xg-fp-head .xg-av{width:40px;height:40px}
.xg-fp-who{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.xg-fp-name{display:flex;align-items:center;gap:4px;font-size:15px;font-weight:700;min-width:0}
.xg-fp-name>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xg-fp-handle{color:var(--muted);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xg-fp-repost{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;font-weight:600;color:var(--muted)}
.xg-fp-repost .xg-ic{width:14px;height:14px}
.xg-fp-text{margin:12px 0 0;font-size:17px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}
.xg-fmedia{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.xg-fitem{position:relative;overflow:hidden;border-radius:14px;border:1px solid var(--border);background:var(--skel)}
.xg-fitem img,.xg-fitem video{display:block;width:100%;height:auto;max-height:72vh;object-fit:contain;
  background:var(--skel)}
.xg-fitem img{cursor:zoom-in}
.xg-fitem .xg-badge{pointer-events:none}
.xg-fp .xg-quote{margin-top:12px;padding:10px 12px;cursor:pointer}
.xg-fp .xg-q-text{font-size:14px;-webkit-line-clamp:4}
.xg-fp .xg-q-thumb{width:64px;height:64px}
.xg-fp-time{margin-top:14px;padding-bottom:12px;border-bottom:1px solid var(--border);color:var(--muted);font-size:14px}
.xg-fp-metrics{display:flex;flex-wrap:wrap;gap:6px 18px;padding:12px 0;border-bottom:1px solid var(--border);
  color:var(--muted);font-size:14px}
.xg-fp-metrics b{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}
.xg-fp .xg-acts{margin:0;padding:6px 0;justify-content:space-around;border-bottom:1px solid var(--border)}
.xg-fp .xg-act{height:36px;padding:0 16px;font-size:13px}
.xg-fp .xg-act .xg-ic{width:20px;height:20px}
.xg-anc{padding-top:6px}

/* ---- lightbox, toast ---------------------------------------------------- */
.xg-lightbox{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
  background:var(--scrim);animation:xg-fade .16s ease-out}
.xg-lb-img{max-width:min(94vw,1800px);max-height:88vh;object-fit:contain;border-radius:4px;box-shadow:0 20px 60px rgba(0,0,0,.6);
  user-select:none}
.xg-lb-btn{position:absolute;display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:50%;
  background:rgba(255,255,255,.12);color:#fff;cursor:pointer;transition:background-color .15s}
.xg-lb-btn:hover{background:rgba(255,255,255,.24)}
.xg-lb-btn .xg-ic{width:22px;height:22px}
.xg-lb-close{top:16px;right:16px}
.xg-lb-prev{left:16px;top:50%;margin-top:-22px}
.xg-lb-next{right:16px;top:50%;margin-top:-22px}
.xg-lb-cap{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:min(80vw,720px);text-align:center;
  color:#e7e9ea;font-size:13px;line-height:1.35;text-shadow:0 1px 8px rgba(0,0,0,.8)}
.xg-lb-cap:empty{display:none}
.xg-toast{position:absolute;left:50%;bottom:64px;z-index:60;max-width:min(92vw,520px);padding:10px 16px;border-radius:10px;
  background:var(--text);color:var(--bg);font-size:13px;font-weight:600;line-height:1.35;box-shadow:var(--shadow);
  opacity:0;transform:translate(-50%,8px);pointer-events:none;transition:opacity .18s,transform .18s}
.xg-toast.xg-on{opacity:1;transform:translate(-50%,0)}

@keyframes xg-spin{to{transform:rotate(360deg)}}
@keyframes xg-drop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes xg-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-duration:0s!important;
    animation-iteration-count:1!important}
  .xg-spin{animation:none}
}
`;

  XG.styles = { css };
})();
