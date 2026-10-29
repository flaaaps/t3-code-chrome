import { type ExtensionEvent, openLivePort, sendRequest } from "@shared/client";
import { isActiveStatus, type LinkState, RUNNING_THREAD_STATUSES, type Session } from "@shared/models";
import { parsePrUrl } from "@shared/prKey";
import { useEffect, useState } from "preact/hooks";

function statusLabel(status: string): string {
  switch (status) {
    case "waiting":
      return "wartet auf dich";
    case "running":
    case "queued":
    case "starting":
    case "preparing":
      return "läuft";
    case "completed":
      return "fertig";
    case "failed":
      return "fehlgeschlagen";
    case "cancelled":
      return "abgebrochen";
    case "interrupted":
      return "unterbrochen";
    default:
      return status;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  return `vor ${Math.round(hours / 24)} d`;
}

/** The popup is the inbox: what waits for you first, then what runs, then what finished today. */
export function Popup() {
  const [link, setLink] = useState<LinkState>("none");
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentPr, setCurrentPr] = useState<string | undefined>(undefined);
  const [lastPr, setLastPr] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [showDone, setShowDone] = useState(false);

  const refresh = async () => {
    try {
      const [list, inbox, { settings }] = await Promise.all([
        sendRequest({ type: "connections.list" }),
        sendRequest({ type: "sessions.inbox" }),
        sendRequest({ type: "settings.get" }),
      ]);
      setLink(list.link);
      setLabel(list.connections.map((c) => c.label).join(", ") || undefined);
      setSessions(inbox.sessions);
      setLastPr(settings.lastPrUrl);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    const port = openLivePort("popup");
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setCurrentPr(tab?.url && parsePrUrl(tab.url) ? tab.url : undefined));
    const listener = (event: ExtensionEvent) => {
      if (event.type === "sessions.updated") setSessions(event.sessions);
      if (event.type === "connections.updated") void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      port?.disconnect();
    };
  }, []);

  const waiting = sessions.filter((s) => s.status === "waiting");
  const running = sessions.filter((s) => RUNNING_THREAD_STATUSES.has(s.status));
  const today = Date.now() - 24 * 3600 * 1000;
  const done = sessions.filter((s) => !isActiveStatus(s.status) && Date.parse(s.updatedAt) > today);

  const openPanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    await chrome.tabs
      .sendMessage(tab.id, { type: "panel.toggle" } satisfies ExtensionEvent)
      .catch(() => undefined);
    window.close();
  };

  return (
    <div class="stack">
      <div class="row">
        <h1 style="flex:1;display:flex;align-items:center;gap:8px">T3 Code</h1>
        <button
          type="button"
          class="btn quiet"
          aria-label="Einstellungen"
          title="Einstellungen"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </div>

      {error ? <div class="alert error">{error}</div> : null}

      {link !== "ready" ? (
        <Wizard link={link} onDone={refresh} />
      ) : (
        <>
          {waiting.length > 0 ? (
            <section class="stack">
              <h3>
                <span class="dot waiting" style="display:inline-block;margin-right:6px" />
                Wartet auf dich ({waiting.length})
              </h3>
              {waiting.map((session) => (
                <InboxCard key={session.key} session={session} onChanged={refresh} />
              ))}
            </section>
          ) : null}
          {running.length > 0 ? (
            <section class="stack">
              <h3>
                <span class="dot running" style="display:inline-block;margin-right:6px" />
                Läuft ({running.length})
              </h3>
              {running.map((session) => (
                <InboxCard key={session.key} session={session} onChanged={refresh} compact />
              ))}
            </section>
          ) : null}
          {done.length > 0 ? (
            <section class="stack">
              <button
                type="button"
                class="btn link"
                style="text-align:left"
                onClick={() => setShowDone((v) => !v)}
              >
                <h3 style="display:inline">
                  <span class="dot done" style="display:inline-block;margin-right:6px" />
                  Heute fertig ({done.length}) {showDone ? "▾" : "▸"}
                </h3>
              </button>
              {showDone
                ? done.map((session) => (
                    <InboxCard key={session.key} session={session} onChanged={refresh} compact />
                  ))
                : null}
            </section>
          ) : null}
          {sessions.length === 0 ? (
            <div class="muted">
              Keine Sessions.{" "}
              {currentPr ? (
                <button type="button" class="btn link" onClick={openPanel}>
                  Auf dieser PR starten
                </button>
              ) : lastPr ? (
                <a href={lastPr} target="_blank" rel="noreferrer">
                  Zur letzten PR
                </a>
              ) : (
                "Öffne einen Pull Request auf github.com."
              )}
            </div>
          ) : null}
          {currentPr && sessions.length > 0 ? (
            <button type="button" class="btn" onClick={openPanel}>
              Composer auf dieser PR öffnen
            </button>
          ) : null}
          <div class="muted row" style="justify-content:space-between">
            <span>{label ?? "T3 Code"} · verbunden</span>
            <button type="button" class="btn link" onClick={() => chrome.runtime.openOptionsPage()}>
              Verbindungen
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function InboxCard({
  session,
  onChanged,
  compact,
}: {
  session: Session;
  onChanged: () => Promise<void>;
  compact?: boolean;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>(undefined);
  const question = session.pending?.[0];
  const prLabel = `${session.pr.repo}#${session.pr.number}`;
  const prUrl = `https://${session.pr.host}/${session.pr.owner}/${session.pr.repo}/pull/${session.pr.number}`;

  const send = async (text: string) => {
    setBusy(true);
    setErr(undefined);
    try {
      await sendRequest({
        type: "session.reply",
        envKey: session.envKey,
        threadId: session.threadId,
        message: text,
        mode: "auto",
        ...(question ? { requestId: question.requestId } : {}),
      });
      setReply("");
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openPr = async () => {
    const [existing] = await chrome.tabs.query({ url: `${prUrl}*` });
    if (existing?.id !== undefined) await chrome.tabs.update(existing.id, { active: true });
    else await chrome.tabs.create({ url: prUrl });
    window.close();
  };

  return (
    <div class="inbox-card">
      <div class="head">
        <a
          class="pr"
          href={prUrl}
          onClick={(e) => {
            e.preventDefault();
            void openPr();
          }}
        >
          {prLabel}
        </a>
        <span class="title" title={session.title}>
          {session.intentName ?? session.title}
        </span>
        <span class="muted">{compact ? statusLabel(session.status) : relativeTime(session.updatedAt)}</span>
      </div>
      {!compact && (question || session.lastMessage) ? (
        <div class={`quote ${question ? "waiting" : "clamp"}`}>
          {question?.text ?? session.lastMessage?.text}
        </div>
      ) : null}
      {err ? <div class="alert error">{err}</div> : null}
      {session.status === "waiting" ? (
        <form
          class="reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) void send(reply.trim());
          }}
        >
          <input
            class="input"
            placeholder="Antwort…"
            value={reply}
            onInput={(e) => setReply((e.target as HTMLInputElement).value)}
          />
          <button type="submit" class="btn small" disabled={busy || !reply.trim()}>
            {busy ? "…" : "Senden"}
          </button>
        </form>
      ) : null}
      <div class="actions">
        <button type="button" class="btn link" onClick={() => void openPr()}>
          PR öffnen
        </button>
        <button
          type="button"
          class="btn link"
          onClick={() =>
            void sendRequest({ type: "thread.open", envKey: session.envKey, threadId: session.threadId })
          }
        >
          In T3
        </button>
        {!isActiveStatus(session.status) && session.jobId ? (
          <button
            type="button"
            class="btn link"
            onClick={() =>
              void sendRequest({ type: "session.dismiss", jobId: session.jobId ?? "" }).then(onChanged)
            }
          >
            Ausblenden
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Three steps: find the local server, paste a pairing code, open a PR. */
function Wizard({ link, onDone }: { link: LinkState; onDone: () => Promise<void> }) {
  const [detect, setDetect] = useState<"idle" | "busy" | "found" | "missing">(
    link === "unpaired" ? "found" : "idle",
  );
  const [code, setCode] = useState("");
  const [access, setAccess] = useState<"full-access" | "read-only">("full-access");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [paired, setPaired] = useState(false);
  const [lastPr, setLastPr] = useState<string | undefined>(undefined);

  useEffect(() => {
    void sendRequest({ type: "settings.get" }).then(({ settings }) => setLastPr(settings.lastPrUrl));
    if (link === "none" || link === "offline") {
      setDetect("busy");
      void sendRequest({ type: "connections.autoDetect" })
        .then((result) =>
          setDetect(result.connection && result.health !== "unreachable" ? "found" : "missing"),
        )
        .catch(() => setDetect("missing"));
    }
  }, [link]);

  const pair = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const list = await sendRequest({ type: "connections.list" });
      const id = list.connections[0]?.id;
      if (!id) throw new Error("Kein T3-Code-Server gefunden.");
      await sendRequest({ type: "connections.pairWithCode", id, code: code.trim(), access });
      setPaired(true);
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const command = 't3 auth pairing create --ttl 10m --label "Chrome"';

  return (
    <div class="stack">
      <div class="wizard-step">
        <span class={`n ${detect === "found" ? "ok" : ""}`}>{detect === "found" ? "✓" : "1"}</span>
        <span>
          {detect === "busy"
            ? "Suche T3 Code auf 127.0.0.1:3773…"
            : detect === "found"
              ? "T3 Code gefunden auf 127.0.0.1:3773"
              : detect === "missing"
                ? "T3 Code läuft nicht. Starte die Desktop-App."
                : "T3 Code suchen"}
        </span>
        {detect === "missing" ? (
          <button type="button" class="btn small" onClick={() => setDetect("idle")}>
            Erneut
          </button>
        ) : null}
      </div>
      <div class="wizard-step" style="align-items:flex-start">
        <span class={`n ${paired ? "ok" : ""}`}>{paired ? "✓" : "2"}</span>
        <div class="stack" style="flex:1">
          <span>Code aus T3 Code einfügen</span>
          <div class="muted">
            Settings → Connections → <strong>Pair a client</strong>, oder im Terminal:
          </div>
          <div class="row">
            <code class="grow" style="overflow:auto;white-space:nowrap">
              {command}
            </code>
            <button
              type="button"
              class="btn small"
              onClick={() => void navigator.clipboard.writeText(command)}
            >
              Kopieren
            </button>
          </div>
          <div class="row">
            <input
              class="input"
              placeholder="Pairing-Code"
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            />
          </div>
          <label class="check">
            <input
              type="radio"
              name="access"
              checked={access === "full-access"}
              onChange={() => setAccess("full-access")}
            />
            <span>
              Vollzugriff <span class="muted">(empfohlen für Reviews, die pushen und kommentieren)</span>
            </span>
          </label>
          <label class="check">
            <input
              type="radio"
              name="access"
              checked={access === "read-only"}
              onChange={() => setAccess("read-only")}
            />
            <span>Nur lesen</span>
          </label>
          {error ? <div class="alert error">{error}</div> : null}
          <div class="row">
            <button
              type="button"
              class="btn primary"
              disabled={busy || !code.trim() || detect !== "found"}
              onClick={() => void pair()}
            >
              {busy ? "Kopple…" : "Koppeln"}
            </button>
            <button type="button" class="btn link" onClick={() => chrome.runtime.openOptionsPage()}>
              Anderen Server
            </button>
          </div>
        </div>
      </div>
      <div class="wizard-step">
        <span class="n">3</span>
        <span>
          Fertig: öffne einen Pull Request{" "}
          {lastPr ? (
            <a href={lastPr} target="_blank" rel="noreferrer">
              zuletzt besucht
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}
