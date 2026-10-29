import { Icon } from "./components";
import * as store from "./store";

export function Toast() {
  const current = store.toast.value;
  if (!current) return null;
  const total = store.settings.value.dispatchDelaySeconds || 1;
  const width =
    current.kind === "countdown" && current.secondsLeft !== undefined
      ? `${(current.secondsLeft / total) * 100}%`
      : "0";
  return (
    <div
      class={`t3-toast ${current.kind}`}
      role={current.kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {current.kind === "countdown" ? (
        <span class="t3-dot running" />
      ) : current.kind === "error" ? (
        <span class="t3-dot failed" />
      ) : (
        <span class="t3-dot done" />
      )}
      <div class="text">
        <span>{current.text}</span>
        {current.detail ? (
          <span class="detail" title={current.detail}>
            {current.detail}
          </span>
        ) : null}
      </div>
      <div class="actions">
        {current.kind === "countdown" ? (
          <>
            <button type="button" class="t3-btn small" onClick={current.onCancel}>
              Abbrechen
            </button>
            <button type="button" class="t3-btn link" onClick={current.onAdjust}>
              Anpassen
            </button>
          </>
        ) : current.session ? (
          <button
            type="button"
            class="t3-btn link"
            onClick={() => current.session && void store.openInT3(current.session)}
          >
            Öffnen <Icon name="external" size={12} />
          </button>
        ) : null}
        <button
          type="button"
          class="t3-btn quiet small"
          aria-label="Schließen"
          onClick={() => store.dismissToast()}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      {current.kind === "countdown" ? <div class="bar" style={{ width }} /> : null}
    </div>
  );
}
