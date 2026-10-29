import { isActiveStatus, RUNNING_THREAD_STATUSES, type SendMode, type Session } from "@shared/models";
import { useState } from "preact/hooks";
import { Icon, relativeTime, StatusDot, statusLabel, statusTone } from "./components";
import * as store from "./store";

/** Inline strip under the PR header listing every session that works on this PR. */
export function AgentBox() {
  const list = store.sessions.value;
  const collapsed = store.agentBoxCollapsed.value;
  if (list.length === 0) return null;
  const waiting = list.filter((s) => s.status === "waiting").length;
  const running = list.filter((s) => RUNNING_THREAD_STATUSES.has(s.status)).length;
  const done = list.filter((s) => !isActiveStatus(s.status)).length;
  const branches = new Map<string, number>();
  for (const session of list) {
    if (session.branch && isActiveStatus(session.status))
      branches.set(session.branch, (branches.get(session.branch) ?? 0) + 1);
  }
  const conflict = [...branches.entries()].find(([, count]) => count > 1);

  return (
    <section
      class={`t3-box ${collapsed ? "collapsed" : ""}`}
      aria-label="T3 Code Sessions zu diesem Pull Request"
    >
      <div class="t3-box-head">
        <span class="title">
          <Icon name="t3" size={14} /> T3 Code
        </span>
        <span class="counts">
          {waiting > 0 ? (
            <span>
              <StatusDot status="waiting" /> {waiting} wartet
            </span>
          ) : null}
          {running > 0 ? (
            <span>
              <StatusDot status="running" /> {running} läuft
            </span>
          ) : null}
          {done > 0 ? (
            <span>
              <StatusDot status="completed" /> {done} fertig
            </span>
          ) : null}
        </span>
        <span class="spacer" />
        <button
          type="button"
          class="t3-btn quiet small"
          aria-expanded={!collapsed}
          onClick={() => {
            store.agentBoxCollapsed.value = !collapsed;
          }}
        >
          {collapsed ? "Anzeigen" : "Einklappen"}
        </button>
      </div>
      {!collapsed ? list.map((session) => <SessionCard key={session.key} session={session} />) : null}
      {!collapsed && conflict ? (
        <div class="t3-warn">
          ⚠ {conflict[1]} Sessions arbeiten gleichzeitig auf <code>{conflict[0]}</code>. Pushes können sich
          überschneiden.
        </div>
      ) : null}
    </section>
  );
}

function SessionCard({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState("");
  const [mode, setMode] = useState<SendMode>("queue");
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const tone = statusTone(session.status);
  const waiting = session.status === "waiting";
  const running = RUNNING_THREAD_STATUSES.has(session.status);
  const question = session.pending?.[0];

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const send = (text: string) =>
    run("send", async () => {
      await store.replyToSession(session, text, waiting ? "auto" : mode, question?.requestId);
      setReply("");
    });

  return (
    <article class="t3-card" aria-label={session.title}>
      <div class={`state ${tone}`}>
        <StatusDot status={session.status} />
        {statusLabel(session.status)}
      </div>
      <div class="head">
        <span class="title" title={session.title}>
          {session.intentName && !session.title.startsWith(session.intentName)
            ? `${session.intentName} · `
            : ""}
          {session.title}
        </span>
        <span class="meta">
          {session.model ? `${session.model} · ` : ""}
          {relativeTime(session.updatedAt)}
        </span>
      </div>
      <div class="body">
        {question ? (
          <div class="t3-quote waiting">{question.text}</div>
        ) : session.lastMessage ? (
          <div>
            <div class={`t3-quote ${expanded ? "" : "clamp"}`}>{session.lastMessage.text}</div>
            {session.lastMessage.text.length > 180 ? (
              <button type="button" class="t3-btn link small" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "weniger" : "mehr"}
              </button>
            ) : null}
          </div>
        ) : session.optimistic ? (
          <div class="t3-muted">Session wird angelegt…</div>
        ) : null}
        {session.error ? <div class="t3-quote error">{session.error}</div> : null}
        {error ? <div class="t3-quote error">{error}</div> : null}

        {waiting && question?.options && question.options.length > 0 ? (
          <div class="t3-options">
            {question.options.map((option) => (
              <button
                type="button"
                key={option}
                class="t3-btn small"
                disabled={!!busy}
                onClick={() => void send(option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {(waiting || running) && !session.optimistic ? (
          <form
            class="t3-reply"
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim()) void send(reply.trim());
            }}
          >
            <input
              class="t3-input"
              placeholder={waiting ? "Antwort…" : "Nachschieben…"}
              value={reply}
              aria-label={waiting ? "Antwort an den Agenten" : "Nachricht nachschieben"}
              onInput={(event) => setReply((event.target as HTMLInputElement).value)}
            />
            {running && !waiting ? (
              <div class="t3-mode" role="group" aria-label="Wann senden">
                <button
                  type="button"
                  class={mode === "queue" ? "active" : ""}
                  onClick={() => setMode("queue")}
                  title="Nach dem aktuellen Schritt"
                >
                  danach
                </button>
                <button
                  type="button"
                  class={mode === "steer" ? "active" : ""}
                  onClick={() => setMode("steer")}
                  title="Sofort einlenken"
                >
                  sofort
                </button>
              </div>
            ) : null}
            <button type="submit" class="t3-btn small" disabled={!!busy || !reply.trim()}>
              <Icon name="send" size={12} /> {busy === "send" ? "Sende…" : "Senden"}
            </button>
            <button
              type="button"
              class="t3-btn small danger"
              disabled={!!busy}
              title="Laufenden Schritt abbrechen"
              onClick={() => void run("stop", () => store.stopSession(session))}
            >
              <Icon name="stop" size={12} /> Stop
            </button>
          </form>
        ) : null}

        <div class="t3-actions">
          <button type="button" class="t3-btn link" onClick={() => void store.openInT3(session)}>
            In T3 öffnen
          </button>
          {!isActiveStatus(session.status) && !session.optimistic ? (
            <button
              type="button"
              class="t3-btn link"
              onClick={() =>
                store.openComposer({
                  intentId: "builtin:free",
                  target: { kind: "session", session },
                })
              }
            >
              Weiterarbeiten
            </button>
          ) : null}
          <button
            type="button"
            class="t3-btn link"
            disabled={busy === "refresh"}
            onClick={() => void run("refresh", () => store.refreshSession(session))}
          >
            {busy === "refresh" ? "Aktualisiere…" : "Aktualisieren"}
          </button>
          {!isActiveStatus(session.status) && session.jobId ? (
            <button type="button" class="t3-btn link" onClick={() => void store.dismissSession(session)}>
              Ausblenden
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
