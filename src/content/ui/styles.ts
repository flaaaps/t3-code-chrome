export const PANEL_STYLES = `
:host {
  all: initial;
  --t3-bg: var(--bgColor-default, var(--color-canvas-default, #ffffff));
  --t3-bg-muted: var(--bgColor-muted, var(--color-canvas-subtle, #f6f8fa));
  --t3-bg-inset: var(--bgColor-inset, var(--color-canvas-inset, #f6f8fa));
  --t3-fg: var(--fgColor-default, var(--color-fg-default, #1f2328));
  --t3-fg-muted: var(--fgColor-muted, var(--color-fg-muted, #59636e));
  --t3-border: var(--borderColor-default, var(--color-border-default, #d1d9e0));
  --t3-border-muted: var(--borderColor-muted, var(--color-border-muted, #d8dee4));
  --t3-accent: var(--bgColor-accent-emphasis, var(--color-accent-emphasis, #0969da));
  --t3-accent-fg: var(--fgColor-accent, var(--color-accent-fg, #0969da));
  --t3-accent-muted: var(--bgColor-accent-muted, var(--color-accent-subtle, #ddf4ff));
  --t3-on-emphasis: var(--fgColor-onEmphasis, var(--color-fg-on-emphasis, #ffffff));
  --t3-success: var(--bgColor-success-emphasis, var(--color-success-emphasis, #1f883d));
  --t3-success-fg: var(--fgColor-success, var(--color-success-fg, #1a7f37));
  --t3-success-muted: var(--bgColor-success-muted, var(--color-success-subtle, #dafbe1));
  --t3-attention: var(--bgColor-attention-emphasis, var(--color-attention-emphasis, #bf8700));
  --t3-attention-fg: var(--fgColor-attention, var(--color-attention-fg, #9a6700));
  --t3-attention-muted: var(--bgColor-attention-muted, var(--color-attention-subtle, #fff8c5));
  --t3-danger-fg: var(--fgColor-danger, var(--color-danger-fg, #d1242f));
  --t3-danger-muted: var(--bgColor-danger-muted, var(--color-danger-subtle, #ffebe9));
  --t3-shadow: var(--shadow-floating-large, 0 8px 24px rgba(31, 35, 40, 0.18));
  --t3-shadow-sm: var(--shadow-resting-small, 0 1px 1px rgba(31, 35, 40, 0.1));
  --t3-radius: 6px;
  --t3-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --t3-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-family: var(--t3-font);
  font-size: 13px;
  color: var(--t3-fg);
  line-height: 1.45;
}
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; }
:focus-visible { outline: 2px solid var(--t3-accent); outline-offset: 2px; border-radius: 4px; }
.t3-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ---- shared ---- */
.t3-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--t3-border); background: var(--t3-bg-muted); color: var(--t3-fg); border-radius: var(--t3-radius); padding: 5px 12px; font-size: 13px; font-weight: 500; white-space: nowrap; line-height: 20px; box-shadow: var(--t3-shadow-sm); }
.t3-btn:hover:not(:disabled) { background: var(--t3-bg-inset); }
.t3-btn:disabled { opacity: 0.55; }
.t3-btn.primary { background: var(--t3-success); border-color: var(--t3-success); color: var(--t3-on-emphasis); }
.t3-btn.primary:hover:not(:disabled) { filter: brightness(0.95); }
.t3-btn.small { padding: 2px 8px; font-size: 12px; line-height: 18px; }
.t3-btn.link { border: none; background: none; color: var(--t3-accent-fg); padding: 0; font-weight: 400; box-shadow: none; }
.t3-btn.link:hover:not(:disabled) { text-decoration: underline; background: none; }
.t3-btn.quiet { border-color: transparent; background: transparent; box-shadow: none; color: var(--t3-fg-muted); padding: 4px 6px; }
.t3-btn.quiet:hover:not(:disabled) { background: var(--t3-bg-inset); color: var(--t3-fg); }
.t3-btn.danger { color: var(--t3-danger-fg); }
.t3-muted { color: var(--t3-fg-muted); font-size: 12px; }
.t3-row { display: flex; gap: 8px; align-items: center; }
.t3-row > .grow { flex: 1; min-width: 0; }
.t3-input, .t3-select, .t3-textarea { width: 100%; border: 1px solid var(--t3-border); border-radius: var(--t3-radius); background: var(--t3-bg); color: var(--t3-fg); padding: 6px 8px; font-size: 13px; }
.t3-input:focus-visible, .t3-select:focus-visible, .t3-textarea:focus-visible { outline: 2px solid var(--t3-accent); outline-offset: -1px; }
.t3-textarea { resize: vertical; min-height: 96px; font-family: var(--t3-font); }
.t3-textarea.mono { font-family: var(--t3-mono); font-size: 12px; min-height: 180px; }
.t3-alert { border: 1px solid var(--t3-border); border-radius: var(--t3-radius); padding: 10px 12px; font-size: 12.5px; background: var(--t3-bg-muted); display: flex; flex-direction: column; gap: 8px; }
.t3-alert.error { border-color: var(--t3-danger-fg); background: var(--t3-danger-muted); }
.t3-alert.success { border-color: var(--t3-success); background: var(--t3-success-muted); }
.t3-spinner { width: 14px; height: 14px; border: 2px solid var(--t3-border); border-top-color: var(--t3-accent); border-radius: 50%; animation: t3-spin 0.8s linear infinite; display: inline-block; }
@keyframes t3-spin { to { transform: rotate(360deg); } }
@keyframes t3-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
kbd.t3-kbd { font-family: var(--t3-mono); font-size: 10px; border: 1px solid var(--t3-border); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; background: var(--t3-bg-muted); color: var(--t3-fg-muted); }
code { font-family: var(--t3-mono); font-size: 12px; background: var(--t3-bg-muted); padding: 1px 4px; border-radius: 4px; }

/* status semantics: running = accent, waiting = attention, done = success, failed = danger */
.t3-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--t3-fg-muted); flex: 0 0 auto; }
.t3-dot.running { background: var(--t3-accent); animation: t3-pulse 1.4s ease-in-out infinite; }
.t3-dot.waiting { background: var(--t3-attention); animation: t3-pulse 0.9s ease-in-out infinite; }
.t3-dot.done { background: var(--t3-success); }
.t3-dot.failed { background: var(--t3-danger-fg); }
.t3-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 0 7px; border-radius: 999px; line-height: 18px; border: 1px solid var(--t3-border); color: var(--t3-fg-muted); background: var(--t3-bg); white-space: nowrap; }
.t3-status.running { border-color: var(--t3-accent); color: var(--t3-accent-fg); }
.t3-status.waiting { border-color: var(--t3-attention); color: var(--t3-attention-fg); background: var(--t3-attention-muted); }
.t3-status.done { border-color: var(--t3-success); color: var(--t3-success-fg); }
.t3-status.failed { border-color: var(--t3-danger-fg); color: var(--t3-danger-fg); }

/* ---- header action ---- */
.t3-header { display: inline-flex; align-items: center; gap: 8px; }
.t3-split { display: inline-flex; border-radius: var(--t3-radius); box-shadow: var(--t3-shadow-sm); }
.t3-split > button { border: 1px solid var(--t3-border); background: var(--t3-bg-muted); color: var(--t3-fg); padding: 3px 10px; font-size: 12px; font-weight: 500; line-height: 20px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.t3-split > button:first-child { border-radius: var(--t3-radius) 0 0 var(--t3-radius); }
.t3-split > button:last-child { border-radius: 0 var(--t3-radius) var(--t3-radius) 0; border-left: none; padding: 3px 6px; }
.t3-split > button:hover:not(:disabled) { background: var(--t3-bg-inset); }
.t3-split > button:disabled { opacity: 0.6; }
.t3-split.primary > button { background: var(--t3-success); border-color: var(--t3-success); color: var(--t3-on-emphasis); }
.t3-split.primary > button:hover:not(:disabled) { filter: brightness(0.95); background: var(--t3-success); }
.t3-split.primary > button:last-child { border-left: 1px solid rgba(255,255,255,0.35); }
.t3-chip-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--t3-border); background: var(--t3-bg); border-radius: 999px; padding: 2px 10px; font-size: 12px; color: var(--t3-fg); line-height: 18px; white-space: nowrap; }
.t3-chip-btn:hover { background: var(--t3-bg-muted); }
.t3-chip-btn.waiting { border-color: var(--t3-attention); color: var(--t3-attention-fg); background: var(--t3-attention-muted); }
.t3-chip-btn.running { border-color: var(--t3-accent); color: var(--t3-accent-fg); }
.t3-menu-wrap { position: relative; display: inline-flex; }
.t3-menu { position: absolute; top: calc(100% + 6px); right: 0; min-width: 280px; background: var(--t3-bg); border: 1px solid var(--t3-border); border-radius: var(--t3-radius); box-shadow: var(--t3-shadow); padding: 6px; z-index: 2147483001; }
.t3-menu[hidden] { display: none; }
.t3-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: none; background: none; padding: 6px 10px; border-radius: 4px; font-size: 13px; color: var(--t3-fg); }
.t3-menu-item:hover, .t3-menu-item:focus-visible { background: var(--t3-bg-muted); outline: none; }
.t3-menu-item .label { flex: 1; }
.t3-menu-item .hint { font-size: 11px; color: var(--t3-fg-muted); }
.t3-menu-item .hint.hot { color: var(--t3-danger-fg); }
.t3-menu-item.primary .label { font-weight: 600; }
.t3-menu-sep { height: 1px; background: var(--t3-border-muted); margin: 6px 0; }
.t3-menu-target { padding: 4px 10px 6px; font-size: 11px; color: var(--t3-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- agent box ---- */
.t3-box { border: 1px solid var(--t3-border); border-radius: var(--t3-radius); background: var(--t3-bg); margin: 12px 0 16px; box-shadow: var(--t3-shadow-sm); }
.t3-box-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--t3-border-muted); background: var(--t3-bg-muted); border-radius: var(--t3-radius) var(--t3-radius) 0 0; font-size: 12px; }
.t3-box-head .title { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.t3-box-head .counts { display: inline-flex; gap: 10px; color: var(--t3-fg-muted); }
.t3-box-head .counts span { display: inline-flex; align-items: center; gap: 4px; }
.t3-box-head .spacer { flex: 1; }
.t3-box.collapsed .t3-box-head { border-bottom: none; border-radius: var(--t3-radius); }
.t3-card { padding: 10px 12px; border-bottom: 1px solid var(--t3-border-muted); display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: start; }
.t3-card:last-child { border-bottom: none; }
.t3-card .state { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; padding-top: 1px; min-width: 96px; }
.t3-card .state.waiting { color: var(--t3-attention-fg); }
.t3-card .state.running { color: var(--t3-accent-fg); }
.t3-card .state.done { color: var(--t3-success-fg); }
.t3-card .state.failed { color: var(--t3-danger-fg); }
.t3-card .head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.t3-card .head .title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.t3-card .head .meta { font-size: 11px; color: var(--t3-fg-muted); white-space: nowrap; }
.t3-card .body { grid-column: 2; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.t3-quote { border-left: 3px solid var(--t3-border); padding: 2px 10px; color: var(--t3-fg); font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
.t3-quote.clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.t3-quote.waiting { border-left-color: var(--t3-attention); background: var(--t3-attention-muted); border-radius: 0 4px 4px 0; padding: 6px 10px; }
.t3-quote.error { border-left-color: var(--t3-danger-fg); color: var(--t3-danger-fg); }
.t3-reply { display: flex; gap: 6px; align-items: center; }
.t3-reply input { flex: 1; min-width: 0; }
.t3-actions { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; align-items: center; }
.t3-options { display: flex; gap: 6px; flex-wrap: wrap; }
.t3-warn { padding: 8px 12px; font-size: 12px; color: var(--t3-attention-fg); background: var(--t3-attention-muted); border-top: 1px solid var(--t3-border-muted); border-radius: 0 0 var(--t3-radius) var(--t3-radius); }
.t3-mode { display: inline-flex; border: 1px solid var(--t3-border); border-radius: var(--t3-radius); overflow: hidden; }
.t3-mode button { border: none; background: var(--t3-bg); padding: 3px 8px; font-size: 11px; color: var(--t3-fg-muted); }
.t3-mode button + button { border-left: 1px solid var(--t3-border); }
.t3-mode button.active { background: var(--t3-accent-muted); color: var(--t3-accent-fg); font-weight: 600; }

/* ---- composer drawer ---- */
.t3-overlay { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
.t3-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(400px, 100vw); background: var(--t3-bg); border-left: 1px solid var(--t3-border); box-shadow: var(--t3-shadow); display: flex; flex-direction: column; pointer-events: auto; }
.t3-drawer[hidden] { display: none; }
.t3-drawer-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--t3-border); }
.t3-drawer-head h2 { margin: 0; font-size: 14px; font-weight: 600; flex: 1; display: flex; align-items: center; gap: 8px; }
.t3-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px 0; }
.t3-chip { border: 1px solid var(--t3-border); background: var(--t3-bg); border-radius: 999px; padding: 2px 10px; font-size: 12px; color: var(--t3-fg); }
.t3-chip:hover { background: var(--t3-bg-muted); }
.t3-chip.active { background: var(--t3-accent-muted); border-color: var(--t3-accent); color: var(--t3-accent-fg); font-weight: 600; }
.t3-drawer-body { flex: 1; overflow: auto; padding: 12px 14px 20px; display: flex; flex-direction: column; gap: 12px; }
.t3-drawer-foot { padding: 10px 14px; border-top: 1px solid var(--t3-border); background: var(--t3-bg-muted); display: flex; gap: 8px; align-items: center; }
.t3-field { display: flex; flex-direction: column; gap: 5px; }
.t3-field > .label { font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
.t3-field > .label .hint { font-weight: 400; color: var(--t3-fg-muted); }
.t3-target { width: 100%; display: flex; align-items: center; gap: 8px; border: 1px solid var(--t3-border); border-radius: var(--t3-radius); background: var(--t3-bg); padding: 6px 10px; text-align: left; font-size: 13px; }
.t3-target:hover { background: var(--t3-bg-muted); }
.t3-target .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3-target .pre { color: var(--t3-fg-muted); }
.t3-list { border: 1px solid var(--t3-border); border-radius: var(--t3-radius); background: var(--t3-bg); max-height: 320px; overflow: auto; box-shadow: var(--t3-shadow); }
.t3-list .group { font-size: 11px; font-weight: 600; color: var(--t3-fg-muted); text-transform: uppercase; letter-spacing: 0.02em; padding: 8px 10px 4px; }
.t3-list .opt { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; border: none; background: none; padding: 6px 10px; font-size: 12.5px; color: var(--t3-fg); }
.t3-list .opt:hover, .t3-list .opt[aria-selected="true"], .t3-list .opt:focus-visible { background: var(--t3-bg-muted); outline: none; }
.t3-list .opt .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3-list .opt .m { font-size: 11px; color: var(--t3-fg-muted); white-space: nowrap; }
.t3-list .search { padding: 8px 10px; border-bottom: 1px solid var(--t3-border-muted); }
.t3-radio { display: flex; gap: 14px; font-size: 12.5px; }
.t3-radio label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
details.t3-details { border: 1px solid var(--t3-border-muted); border-radius: var(--t3-radius); padding: 6px 10px; }
details.t3-details summary { cursor: pointer; font-size: 12px; color: var(--t3-fg-muted); user-select: none; list-style: none; display: flex; align-items: center; gap: 6px; }
details.t3-details summary::-webkit-details-marker { display: none; }
details.t3-details summary::before { content: "▸"; font-size: 10px; }
details.t3-details[open] summary::before { content: "▾"; }
details.t3-details[open] summary { margin-bottom: 8px; }
details.t3-details .content { display: flex; flex-direction: column; gap: 8px; }
.t3-comment-quote { border: 1px solid var(--t3-border); border-left: 3px solid var(--t3-accent); border-radius: var(--t3-radius); padding: 8px 10px; font-size: 12px; background: var(--t3-bg-muted); display: flex; flex-direction: column; gap: 4px; }
.t3-comment-quote .where { color: var(--t3-fg-muted); font-size: 11px; display: flex; gap: 8px; align-items: center; }
.t3-comment-quote .text { white-space: pre-wrap; max-height: 120px; overflow: auto; }
.t3-setup { display: flex; flex-direction: column; gap: 10px; }
.t3-setup ol { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.t3-code { display: flex; gap: 6px; align-items: center; }
.t3-code code { flex: 1; overflow: auto; white-space: nowrap; padding: 4px 8px; }

/* ---- toast ---- */
.t3-toast { position: fixed; right: 16px; bottom: 16px; z-index: 2147483002; background: var(--t3-bg); color: var(--t3-fg); border: 1px solid var(--t3-border); border-radius: var(--t3-radius); box-shadow: var(--t3-shadow); padding: 10px 14px; display: flex; gap: 12px; align-items: center; min-width: 300px; max-width: 460px; pointer-events: auto; font-size: 13px; }
.t3-toast .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.t3-toast .text .detail { font-size: 11.5px; color: var(--t3-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3-toast .bar { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--t3-accent); border-radius: 0 0 0 var(--t3-radius); transition: width 1s linear; }
.t3-toast.error { border-color: var(--t3-danger-fg); }
.t3-toast .actions { display: flex; gap: 10px; }

/* ---- comment action ---- */
.t3-cbtn { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; padding: 0 6px; height: 24px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--t3-fg-muted); font-size: 12px; }
.t3-cbtn:hover { color: var(--t3-fg); background: var(--t3-bg-muted); border-color: var(--t3-border); }
.t3-cmenu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 240px; background: var(--t3-bg); border: 1px solid var(--t3-border); border-radius: var(--t3-radius); box-shadow: var(--t3-shadow); padding: 6px; z-index: 2147483001; }
.t3-cmenu[hidden] { display: none; }
`;
