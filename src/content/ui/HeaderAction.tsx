import { intentReason } from "@shared/intent";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon, Spinner } from "./components";
import * as store from "./store";

/** Split button in the PR header: primary intent, menu with the other intents, status chip. */
export function HeaderAction({ onJumpToSessions }: { onJumpToSessions: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const status = store.status.value;
  const error = store.loadError.value;
  const context = store.pr.value;
  const suggested = store.suggestedIntent.value;
  const active = store.activeSessions.value;
  const waiting = store.waitingSessions.value;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      const path = event.composedPath();
      if (wrap.current && !path.includes(wrap.current)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!context) return null;

  const chip =
    active.length > 0 ? (
      <button
        type="button"
        class={`t3-chip-btn ${waiting.length > 0 ? "waiting" : "running"}`}
        onClick={onJumpToSessions}
        title="Zu den Sessions springen"
      >
        <span class={`t3-dot ${waiting.length > 0 ? "waiting" : "running"}`} />
        {waiting.length > 0 ? `${waiting.length} wartet` : `${active.length} läuft`}
      </button>
    ) : null;

  if (status === "error" && error) {
    if (error.code === "none" || error.code === "unpaired") {
      return (
        <div class="t3-header">
          <button type="button" class="t3-btn" onClick={() => store.openComposer()}>
            <Icon name="t3" /> T3 Code einrichten
          </button>
        </div>
      );
    }
    return (
      <div class="t3-header">
        {chip}
        <button type="button" class="t3-btn" onClick={() => void store.retryLink()} title={error.message}>
          <Icon name="t3" /> T3 Code offline · erneut prüfen
        </button>
      </div>
    );
  }

  const loading = status === "loading" || status === "idle";
  const label = suggested?.actionLabel ?? suggested?.name ?? "Review starten";
  const reason = suggested ? intentReason(context, suggested) : undefined;

  return (
    <div class="t3-header" ref={wrap}>
      {chip}
      <div class="t3-menu-wrap">
        <div class={`t3-split ${loading ? "" : "primary"}`}>
          <button
            type="button"
            disabled={loading}
            title={reason ? `${label} (${reason})` : `${label} mit Standardeinstellungen`}
            onClick={() => suggested && store.quickDispatch(suggested.id)}
          >
            {loading ? <Spinner /> : <Icon name="play" size={12} />}
            {loading ? "T3 Code" : label}
          </button>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Weitere Aktionen"
            disabled={loading}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="chevron" size={12} />
          </button>
        </div>
        <div class="t3-menu" role="menu" hidden={!open}>
          {store.templates.value.map((template) => {
            const why = intentReason(context, template);
            return (
              <button
                type="button"
                role="menuitem"
                key={template.id}
                class={`t3-menu-item ${template.id === suggested?.id ? "primary" : ""}`}
                onClick={() => {
                  setOpen(false);
                  store.quickDispatch(template.id);
                }}
              >
                <span class="label">{template.actionLabel ?? template.name}</span>
                {template.id === suggested?.id ? <span class="hint">Standard</span> : null}
                {why ? <span class="hint hot">● {why}</span> : null}
              </button>
            );
          })}
          <div class="t3-menu-sep" />
          <button
            type="button"
            role="menuitem"
            class="t3-menu-item"
            onClick={() => {
              setOpen(false);
              store.openComposer({ intentId: suggested?.id ?? "builtin:review" });
            }}
          >
            <span class="label">Anpassen…</span>
            {store.shortcut.value ? (
              <span class="hint">
                <kbd class="t3-kbd">{store.shortcut.value}</kbd>
              </span>
            ) : null}
          </button>
          <div class="t3-menu-target" title={store.targetLabel(store.composerTarget.value, context)}>
            Ziel: {store.targetLabel(store.composerTarget.value, context)}
          </div>
        </div>
      </div>
    </div>
  );
}
