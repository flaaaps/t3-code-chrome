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
  --t3-attention: var(--bgColor-attention-emphasis, var(--color-attention-emphasis, #bf8700));
  --t3-attention-fg: var(--fgColor-attention, var(--color-attention-fg, #9a6700));
  --t3-danger-fg: var(--fgColor-danger, var(--color-danger-fg, #d1242f));
  --t3-danger-muted: var(--bgColor-danger-muted, var(--color-danger-subtle, #ffebe9));
  --t3-brand: #4f46e5;
  --t3-shadow: var(--shadow-floating-large, 0 8px 24px rgba(31, 35, 40, 0.18));
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

.t3-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: var(--t3-radius);
  border: 1px solid var(--t3-border); background: var(--t3-bg-muted);
  color: var(--t3-fg); font-weight: 500; font-size: 12px; line-height: 20px; cursor: pointer;
  white-space: nowrap;
}
.t3-trigger:hover { background: var(--t3-bg-inset); border-color: var(--t3-fg-muted); }
.t3-trigger .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--t3-brand); }
.t3-trigger .dot.running { background: var(--t3-attention); animation: t3-pulse 1.2s ease-in-out infinite; }
.t3-trigger .dot.waiting { background: var(--t3-danger-fg); animation: t3-pulse 0.8s ease-in-out infinite; }
.t3-trigger .badge { font-size: 11px; padding: 0 6px; border-radius: 10px; background: var(--t3-brand); color: #fff; line-height: 16px; }
@keyframes t3-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.t3-comment-btn {
  display: inline-flex; align-items: center; gap: 4px; margin-left: 4px;
  padding: 0 6px; height: 22px; border-radius: 4px; border: 1px solid transparent;
  background: transparent; color: var(--t3-fg-muted); font-size: 11px; cursor: pointer;
}
.t3-comment-btn:hover { color: var(--t3-fg); background: var(--t3-bg-muted); border-color: var(--t3-border); }

.t3-overlay { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
.t3-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 100vw);
  background: var(--t3-bg); border-left: 1px solid var(--t3-border); box-shadow: var(--t3-shadow);
  display: flex; flex-direction: column; pointer-events: auto;
  transform: translateX(0); transition: transform 160ms ease-out;
}
.t3-panel[hidden] { display: none; }
.t3-header {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  border-bottom: 1px solid var(--t3-border); background: var(--t3-bg-muted);
}
.t3-header h2 { margin: 0; font-size: 14px; font-weight: 600; flex: 1; display: flex; align-items: center; gap: 8px; }
.t3-logo { width: 18px; height: 18px; border-radius: 4px; background: var(--t3-brand); color: #fff; font-size: 9px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.t3-icon-btn { border: none; background: transparent; color: var(--t3-fg-muted); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 14px; line-height: 1; }
.t3-icon-btn:hover { background: var(--t3-bg-inset); color: var(--t3-fg); }
.t3-body { flex: 1; overflow: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 14px; }
.t3-footer { padding: 12px 16px; border-top: 1px solid var(--t3-border); background: var(--t3-bg-muted); display: flex; gap: 8px; align-items: center; }

.t3-section { display: flex; flex-direction: column; gap: 6px; }
.t3-label { font-size: 12px; font-weight: 600; color: var(--t3-fg); display: flex; justify-content: space-between; align-items: center; }
.t3-label .hint { font-weight: 400; color: var(--t3-fg-muted); }
.t3-muted { color: var(--t3-fg-muted); font-size: 12px; }
.t3-pr { font-size: 12px; color: var(--t3-fg-muted); }
.t3-pr strong { color: var(--t3-fg); font-weight: 600; }

.t3-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.t3-chip {
  border: 1px solid var(--t3-border); background: var(--t3-bg); border-radius: 999px;
  padding: 3px 10px; font-size: 12px; cursor: pointer; color: var(--t3-fg);
}
.t3-chip:hover { background: var(--t3-bg-muted); }
.t3-chip.active { background: var(--t3-accent); border-color: var(--t3-accent); color: var(--t3-on-emphasis); }

.t3-segment { display: inline-flex; border: 1px solid var(--t3-border); border-radius: var(--t3-radius); overflow: hidden; }
.t3-segment button { border: none; background: var(--t3-bg); padding: 5px 12px; cursor: pointer; font-size: 12px; color: var(--t3-fg); }
.t3-segment button + button { border-left: 1px solid var(--t3-border); }
.t3-segment button.active { background: var(--t3-accent-muted); color: var(--t3-accent-fg); font-weight: 600; }

.t3-select, .t3-input, .t3-textarea {
  width: 100%; border: 1px solid var(--t3-border); border-radius: var(--t3-radius);
  background: var(--t3-bg); color: var(--t3-fg); padding: 5px 8px; font-size: 13px;
}
.t3-select:focus, .t3-input:focus, .t3-textarea:focus { outline: 2px solid var(--t3-accent); outline-offset: -1px; }
.t3-textarea { min-height: 72px; resize: vertical; font-family: var(--t3-font); }
.t3-textarea.mono { font-family: var(--t3-mono); font-size: 12px; min-height: 160px; }
.t3-row { display: flex; gap: 8px; align-items: center; }
.t3-row > * { flex: 1; min-width: 0; }
.t3-row > .fixed { flex: 0 0 auto; }

.t3-threads { display: flex; flex-direction: column; border: 1px solid var(--t3-border); border-radius: var(--t3-radius); max-height: 260px; overflow: auto; }
.t3-thread { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-bottom: 1px solid var(--t3-border-muted); cursor: pointer; background: var(--t3-bg); text-align: left; border-left: 3px solid transparent; }
.t3-thread:last-child { border-bottom: none; }
.t3-thread:hover { background: var(--t3-bg-muted); }
.t3-thread.active { background: var(--t3-accent-muted); border-left-color: var(--t3-accent); }
.t3-thread .title { font-weight: 500; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.t3-thread .meta { font-size: 11px; color: var(--t3-fg-muted); display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.t3-thread .main { flex: 1; min-width: 0; }

.t3-status { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 0 7px; border-radius: 999px; line-height: 18px; border: 1px solid var(--t3-border); color: var(--t3-fg-muted); background: var(--t3-bg-muted); white-space: nowrap; }
.t3-status.running, .t3-status.starting, .t3-status.queued, .t3-status.preparing { border-color: var(--t3-attention); color: var(--t3-attention-fg); }
.t3-status.waiting { border-color: var(--t3-danger-fg); color: var(--t3-danger-fg); background: var(--t3-danger-muted); }
.t3-status.completed { border-color: var(--t3-success); color: var(--t3-success-fg); }
.t3-status.failed, .t3-status.cancelled, .t3-status.interrupted { border-color: var(--t3-danger-fg); color: var(--t3-danger-fg); }
.t3-status.pr { border-color: var(--t3-brand); color: var(--t3-brand); }

.t3-btn { border: 1px solid var(--t3-border); background: var(--t3-bg-muted); color: var(--t3-fg); border-radius: var(--t3-radius); padding: 5px 12px; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.t3-btn:hover:not(:disabled) { background: var(--t3-bg-inset); }
.t3-btn:disabled { opacity: 0.6; cursor: default; }
.t3-btn.primary { background: var(--t3-success); border-color: var(--t3-success); color: var(--t3-on-emphasis); }
.t3-btn.primary:hover:not(:disabled) { filter: brightness(0.95); }
.t3-btn.small { padding: 2px 8px; font-size: 12px; }
.t3-btn.link { border: none; background: none; color: var(--t3-accent-fg); padding: 0; font-weight: 400; }
.t3-btn.link:hover:not(:disabled) { text-decoration: underline; background: none; }

.t3-alert { border: 1px solid var(--t3-border); border-radius: var(--t3-radius); padding: 10px 12px; font-size: 12.5px; background: var(--t3-bg-muted); display: flex; flex-direction: column; gap: 8px; }
.t3-alert.error { border-color: var(--t3-danger-fg); background: var(--t3-danger-muted); }
.t3-alert.success { border-color: var(--t3-success); }

details.t3-details { border: 1px solid var(--t3-border-muted); border-radius: var(--t3-radius); padding: 6px 10px; }
details.t3-details summary { cursor: pointer; font-size: 12px; color: var(--t3-fg-muted); user-select: none; }
details.t3-details[open] summary { margin-bottom: 8px; }
details.t3-details .content { display: flex; flex-direction: column; gap: 8px; }

.t3-jobs { display: flex; flex-direction: column; gap: 8px; }
.t3-job { border: 1px solid var(--t3-border); border-radius: var(--t3-radius); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.t3-job .head { display: flex; gap: 8px; align-items: center; }
.t3-job .head .title { flex: 1; font-weight: 500; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3-job .reply { font-size: 12px; color: var(--t3-fg-muted); white-space: pre-wrap; max-height: 120px; overflow: auto; background: var(--t3-bg-muted); padding: 6px 8px; border-radius: 4px; }
.t3-job .actions { display: flex; gap: 10px; }

.t3-spinner { width: 14px; height: 14px; border: 2px solid var(--t3-border); border-top-color: var(--t3-accent); border-radius: 50%; animation: t3-spin 0.8s linear infinite; display: inline-block; }
@keyframes t3-spin { to { transform: rotate(360deg); } }
.t3-center { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 24px; color: var(--t3-fg-muted); }
kbd.t3-kbd { font-family: var(--t3-mono); font-size: 10px; border: 1px solid var(--t3-border); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; background: var(--t3-bg-muted); }
`;
