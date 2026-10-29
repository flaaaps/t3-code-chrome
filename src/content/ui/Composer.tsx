import { sendRequest } from "@shared/client";
import { isActiveStatus, type RuntimeMode, type ThreadSummary } from "@shared/models";
import { rankThreads } from "@shared/sort";
import { defaultThreadTitle } from "@shared/templates/render";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Alert, Icon, relativeTime, Spinner, StatusChip } from "./components";
import type { TargetChoice } from "./store";
import * as store from "./store";

const RUNTIME_MODES: Array<{ value: RuntimeMode; label: string }> = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "approval-required", label: "Approval required" },
];

/** Right-hand drawer for the long tail: text first, target as one line, the rest under "Erweitert". */
export function Composer({ returnFocusTo }: { returnFocusTo: () => void }) {
  const open = store.composerOpen.value;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const context = store.pr.value;

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => textarea.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        store.closeComposer();
        returnFocusTo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void store.submitComposer();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, returnFocusTo]);

  if (!context) return null;
  const status = store.status.value;
  const error = store.loadError.value;
  const template = store.intent.value;
  const missing = store.missing.value;
  const choice = store.composerTarget.value;
  const submitting = store.composerSubmitting.value;
  const canSend =
    status === "ready" &&
    !!choice &&
    choice.kind !== "create-project" &&
    missing.length === 0 &&
    store.prompt.value.trim().length > 0 &&
    !submitting;
  const sendLabel = missing.includes("note")
    ? "Text fehlt"
    : missing.includes("comment")
      ? "Kommentar fehlt"
      : choice?.kind === "session" || choice?.kind === "thread"
        ? "Senden"
        : "Starten";

  return (
    <div class="t3-overlay">
      <section
        class="t3-drawer"
        hidden={!open}
        role="dialog"
        aria-modal="false"
        aria-labelledby="t3-composer-title"
      >
        <header class="t3-drawer-head">
          <h2 id="t3-composer-title">
            <Icon name="t3" /> {template?.name ?? "T3 Code"}
          </h2>
          <button
            type="button"
            class="t3-btn quiet"
            aria-label="Einstellungen öffnen"
            title="Einstellungen"
            onClick={() => void sendRequest({ type: "options.open" })}
          >
            <Icon name="gear" />
          </button>
          <button
            type="button"
            class="t3-btn quiet"
            aria-label="Schließen"
            title="Schließen (Esc)"
            onClick={() => {
              store.closeComposer();
              returnFocusTo();
            }}
          >
            <Icon name="close" />
          </button>
        </header>

        {status === "error" && error ? (
          <div class="t3-drawer-body">
            <LinkProblem />
          </div>
        ) : status !== "ready" ? (
          <div class="t3-drawer-body">
            <div class="t3-row" style="justify-content:center;padding:24px 0">
              <Spinner /> <span class="t3-muted">Lade Projekte und Sessions…</span>
            </div>
          </div>
        ) : (
          <>
            <div class="t3-chips" role="tablist" aria-label="Aktion">
              {store.templates.value.map((t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={t.id === template?.id}
                  key={t.id}
                  class={`t3-chip ${t.id === template?.id ? "active" : ""}`}
                  title={t.description ?? ""}
                  onClick={() => store.selectIntent(t.id)}
                >
                  {t.actionLabel ?? t.name}
                </button>
              ))}
            </div>
            <div class="t3-drawer-body">
              {store.composerComment.value ? <CommentQuote /> : null}

              <div class="t3-field">
                <textarea
                  ref={textarea}
                  class="t3-textarea"
                  aria-label={
                    template?.requires?.includes("note") ? "Dein Auftrag" : "Hinweis für den Agenten"
                  }
                  placeholder={
                    template?.requires?.includes("note")
                      ? "Was soll der Agent tun?"
                      : "Fokus, Kontext, Ausnahmen… (optional)"
                  }
                  value={store.composerNote.value}
                  onInput={(event) => {
                    store.composerNote.value = (event.target as HTMLTextAreaElement).value;
                  }}
                />
                <details class="t3-details">
                  <summary>
                    Prompt ansehen/bearbeiten
                    {store.composerCustomPrompt.value !== undefined ? " (manuell)" : ""}
                  </summary>
                  <div class="content">
                    <textarea
                      class="t3-textarea mono"
                      aria-label="Vollständiger Prompt"
                      value={store.prompt.value}
                      onInput={(event) => {
                        store.composerCustomPrompt.value = (event.target as HTMLTextAreaElement).value;
                      }}
                    />
                    {store.composerCustomPrompt.value !== undefined ? (
                      <button
                        type="button"
                        class="t3-btn link"
                        onClick={() => {
                          store.composerCustomPrompt.value = undefined;
                        }}
                      >
                        Auf Vorlage zurücksetzen
                      </button>
                    ) : null}
                  </div>
                </details>
              </div>

              <TargetField />

              {template?.reviewOutput ? (
                <div class="t3-field">
                  <div class="label">Ergebnis</div>
                  <div class="t3-radio" role="radiogroup" aria-label="Ergebnis">
                    <label>
                      <input
                        type="radio"
                        name="t3-review-output"
                        checked={store.composerReviewOutput.value === "inline"}
                        onChange={() => {
                          store.composerReviewOutput.value = "inline";
                        }}
                      />
                      Inline-Kommentare auf GitHub
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="t3-review-output"
                        checked={store.composerReviewOutput.value === "report"}
                        onChange={() => {
                          store.composerReviewOutput.value = "report";
                        }}
                      />
                      Nur Bericht in T3
                    </label>
                  </div>
                </div>
              ) : null}

              <Advanced />

              {store.composerError.value ? <Alert kind="error">{store.composerError.value}</Alert> : null}
            </div>
            <footer class="t3-drawer-foot">
              <span class="t3-muted" style="flex:1">
                {template?.reviewOutput && store.composerReviewOutput.value === "inline" && context.viewer
                  ? `postet als @${context.viewer}`
                  : choice?.kind === "new"
                    ? "Neue Session in T3 Code"
                    : ""}
              </span>
              <button
                type="button"
                class="t3-btn primary"
                disabled={!canSend}
                onClick={() => void store.submitComposer()}
              >
                {submitting ? "Sende…" : sendLabel} <kbd class="t3-kbd">⌘↩</kbd>
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function CommentQuote() {
  const comment = store.composerComment.value;
  if (!comment) return null;
  return (
    <div class="t3-comment-quote">
      <div class="where">
        {comment.file ? (
          <code>
            {comment.file}
            {comment.line ? `:${comment.line}` : ""}
          </code>
        ) : null}
        {comment.author ? <span>von {comment.author}</span> : null}
        {comment.url ? (
          <a href={comment.url} target="_blank" rel="noreferrer">
            Kommentar öffnen
          </a>
        ) : null}
        <span style="flex:1" />
        <button
          type="button"
          class="t3-btn link"
          onClick={() => {
            store.composerComment.value = undefined;
          }}
        >
          entfernen
        </button>
      </div>
      <div class="text">{comment.text}</div>
    </div>
  );
}

function TargetField() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ThreadSummary[] | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [path, setPath] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const context = store.pr.value;
  const data = store.overview.value;
  const choice = store.composerTarget.value;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      if (wrap.current && !event.composedPath().includes(wrap.current)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  const groups = useMemo(() => {
    if (!data || !context) return [];
    const envKey =
      store.choiceEnvKey(choice) ?? data.defaults.envKey ?? data.environments.find((e) => e.reachable)?.key;
    const projectsById = new Map(data.projects.map((p) => [p.id, p]));
    const ranked = rankThreads(data.threads, store.prKey(context), data.suggestedProjectId);
    const sessionThreadIds = new Set(store.sessions.value.map((s) => s.threadId));
    const out: Array<{
      title: string;
      items: Array<{ choice: TargetChoice; label: string; meta?: string; status?: string }>;
    }> = [];

    const thisPr = store.sessions.value.map((session) => ({
      choice: { kind: "session", session } as TargetChoice,
      label: session.title,
      meta: session.model ?? "",
      status: session.status,
    }));
    for (const entry of ranked.filter(
      (r) => r.group === "this-pr" && !sessionThreadIds.has(r.thread.threadId),
    )) {
      thisPr.push({
        choice: {
          kind: "thread",
          threadId: entry.thread.threadId,
          envKey: entry.thread.envKey,
          title: entry.thread.title,
          status: entry.thread.status,
        },
        label: entry.thread.title,
        meta: relativeTime(entry.thread.updatedAt),
        status: entry.thread.status,
      });
    }
    if (thisPr.length > 0) out.push({ title: "Diese PR", items: thisPr });

    const newItems: Array<{ choice: TargetChoice; label: string; meta?: string }> = [];
    const project = data.suggestedProjectId ? projectsById.get(data.suggestedProjectId) : undefined;
    if (project && envKey) {
      if (context.headBranch) {
        newItems.push({
          choice: {
            kind: "new",
            envKey: project.envKey,
            projectId: project.id,
            projectTitle: project.title,
            workspace: "worktree",
          },
          label: `${project.title} · Worktree ${context.headBranch}`,
          meta: data.defaults.modelLabel ?? "",
        });
      }
      newItems.push({
        choice: {
          kind: "new",
          envKey: project.envKey,
          projectId: project.id,
          projectTitle: project.title,
          workspace: "root",
        },
        label: `${project.title} · Projekt-Checkout`,
      });
    }
    for (const other of data.projects.filter((p) => p.id !== project?.id).slice(0, 8)) {
      newItems.push({
        choice: {
          kind: "new",
          envKey: other.envKey,
          projectId: other.id,
          projectTitle: other.title,
          workspace: context.headBranch ? "worktree" : "root",
        },
        label: other.title,
        meta: other.repoDisplayName ?? "",
      });
    }
    if (envKey) {
      if (!project)
        newItems.unshift({
          choice: { kind: "create-project", envKey },
          label: `Projekt für ${context.owner}/${context.repo} anlegen…`,
        });
      newItems.push({ choice: { kind: "scratch", envKey }, label: "Ohne Projekt (Scratch-Ordner)" });
    }
    out.push({ title: "Neu", items: newItems });

    const recent = ranked
      .filter(
        (r) =>
          (r.group === "project-active" || r.group === "project") && !sessionThreadIds.has(r.thread.threadId),
      )
      .slice(0, 6)
      .map((entry) => ({
        choice: {
          kind: "thread",
          threadId: entry.thread.threadId,
          envKey: entry.thread.envKey,
          title: entry.thread.title,
          status: entry.thread.status,
        } as TargetChoice,
        label: entry.thread.title,
        meta: relativeTime(entry.thread.updatedAt),
        status: entry.thread.status,
      }));
    if (recent.length > 0) out.push({ title: `${project?.title ?? "Projekt"}, zuletzt`, items: recent });
    return out;
  }, [data, context, store.choiceEnvKey(choice), store.sessions.value]);

  useEffect(() => {
    if (!open || query.trim().length < 2 || !data) {
      setResults(undefined);
      return;
    }
    const envKey = store.choiceEnvKey(choice) ?? data.defaults.envKey;
    if (!envKey) return;
    setSearching(true);
    const timer = setTimeout(() => {
      void sendRequest({ type: "threads.search", envKey, query: query.trim() })
        .then(({ threads }) => setResults(threads))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, data, store.choiceEnvKey(choice)]);

  if (!context || !data) return null;

  const pick = (next: TargetChoice) => {
    if (next.kind === "create-project") {
      setCreating(true);
      setOpen(false);
      return;
    }
    store.composerTarget.value = next;
    setOpen(false);
  };

  const create = async () => {
    const envKey = store.choiceEnvKey(choice) ?? data.defaults.envKey;
    if (!envKey || !path.trim()) return;
    setCreateBusy(true);
    setCreateError(undefined);
    try {
      const { project } = await sendRequest({
        type: "project.create",
        envKey,
        pr: store.prKey(context),
        destinationPath: path.trim(),
      });
      await store.load(true);
      store.composerTarget.value = {
        kind: "new",
        envKey,
        projectId: project.id,
        projectTitle: project.title,
        workspace: context.headBranch ? "worktree" : "root",
      };
      setCreating(false);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreateBusy(false);
    }
  };

  const selectedThreadRunning =
    (choice?.kind === "session" &&
      isActiveStatus(choice.session.status) &&
      choice.session.status !== "waiting") ||
    (choice?.kind === "thread" && isActiveStatus(choice.status) && choice.status !== "waiting");

  return (
    <div class="t3-field" ref={wrap}>
      <div class="label">
        An
        {data.environments.filter((e) => e.reachable).length > 1 ? (
          <select
            class="t3-select"
            style="width:auto;max-width:180px"
            aria-label="Environment"
            value={store.choiceEnvKey(choice) ?? data.defaults.envKey ?? ""}
            onChange={(event) => {
              const envKey = (event.target as HTMLSelectElement).value;
              store.composerTarget.value = { kind: "scratch", envKey };
            }}
          >
            {data.environments
              .filter((e) => e.reachable)
              .map((env) => (
                <option key={env.key} value={env.key}>
                  {env.label}
                </option>
              ))}
          </select>
        ) : null}
      </div>
      <button
        type="button"
        class="t3-target"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {choice?.kind === "session" ? (
          <StatusChip status={choice.session.status} />
        ) : choice?.kind === "thread" ? (
          <StatusChip status={choice.status} />
        ) : (
          <span class="pre">Neu</span>
        )}
        <span class="text">{store.targetLabel(choice, context).replace(/^Neu in /, "")}</span>
        <Icon name="chevron" size={12} />
      </button>
      {open ? (
        <div class="t3-list" role="listbox" aria-label="Ziel">
          <div class="search">
            <input
              class="t3-input"
              placeholder="Alle Sessions durchsuchen…"
              value={query}
              aria-label="Sessions durchsuchen"
              onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
            />
          </div>
          {results !== undefined ? (
            <>
              <div class="group">Suche {searching ? "…" : `(${results.length})`}</div>
              {results.map((thread) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={choice?.kind === "thread" && choice.threadId === thread.threadId}
                  key={thread.threadId}
                  class="opt"
                  onClick={() =>
                    pick({
                      kind: "thread",
                      threadId: thread.threadId,
                      envKey: thread.envKey,
                      title: thread.title,
                      status: thread.status,
                    })
                  }
                >
                  <StatusChip status={thread.status} />
                  <span class="t">{thread.title}</span>
                  <span class="m">{relativeTime(thread.updatedAt)}</span>
                </button>
              ))}
            </>
          ) : (
            groups.map((group) => (
              <div key={group.title}>
                <div class="group">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={sameChoice(item.choice, choice)}
                    key={item.label}
                    class="opt"
                    onClick={() => pick(item.choice)}
                  >
                    {item.status ? <StatusChip status={item.status} /> : <span class="t3-muted">○</span>}
                    <span class="t">{item.label}</span>
                    {item.meta ? <span class="m">{item.meta}</span> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}

      {selectedThreadRunning ? (
        <div class="t3-row">
          <span class="t3-muted">Diese Session läuft gerade:</span>
          <div class="t3-mode" role="group" aria-label="Wann senden">
            <button
              type="button"
              class={store.composerSendMode.value === "queue" ? "active" : ""}
              onClick={() => {
                store.composerSendMode.value = "queue";
              }}
            >
              nach dem aktuellen Schritt
            </button>
            <button
              type="button"
              class={store.composerSendMode.value === "steer" ? "active" : ""}
              onClick={() => {
                store.composerSendMode.value = "steer";
              }}
            >
              sofort
            </button>
          </div>
        </div>
      ) : null}

      {creating ? (
        <div class="t3-alert">
          <div>
            T3 kennt noch kein Projekt für{" "}
            <strong>
              {context.owner}/{context.repo}
            </strong>
            . Das Repository wird in diesen Ordner geklont und als Projekt registriert:
          </div>
          <input
            class="t3-input"
            placeholder={`/Users/…/Programming/${context.repo}`}
            value={path}
            onInput={(event) => setPath((event.target as HTMLInputElement).value)}
          />
          {createError ? <div class="t3-quote error">{createError}</div> : null}
          <div class="t3-row">
            <button
              type="button"
              class="t3-btn primary small"
              disabled={!path.trim() || createBusy}
              onClick={() => void create()}
            >
              {createBusy ? "Klone…" : "Klonen & anlegen"}
            </button>
            <button type="button" class="t3-btn link" onClick={() => setCreating(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sameChoice(a: TargetChoice, b: TargetChoice | undefined): boolean {
  if (!b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case "session":
      return b.kind === "session" && a.session.threadId === b.session.threadId;
    case "thread":
      return b.kind === "thread" && a.threadId === b.threadId;
    case "new":
      return b.kind === "new" && a.projectId === b.projectId && a.workspace === b.workspace;
    default:
      return true;
  }
}

function Advanced() {
  const data = store.overview.value;
  const context = store.pr.value;
  const choice = store.composerTarget.value;
  const template = store.intent.value;
  if (!data || !context) return null;
  const envKey = store.choiceEnvKey(choice) ?? data.defaults.envKey ?? "";
  const capabilities = data.capabilities[envKey];
  const models = (capabilities?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({
      key: `${provider.providerInstanceId}::${model.id}`,
      label: `${provider.displayName} · ${model.label ?? model.id}`,
    })),
  );
  const isNew = choice?.kind === "new" || choice?.kind === "scratch";
  return (
    <details class="t3-details">
      <summary>
        Erweitert <span class="t3-muted">· Modell · Modus{isNew ? " · Titel" : ""}</span>
      </summary>
      <div class="content">
        <div class="t3-row">
          <select
            class="t3-select"
            aria-label="Modell"
            value={store.composerModelKey.value}
            onChange={(event) => {
              store.composerModelKey.value = (event.target as HTMLSelectElement).value;
            }}
          >
            <option value="">
              Standardmodell{data.defaults.modelLabel ? ` (${data.defaults.modelLabel})` : ""}
            </option>
            {models.map((model) => (
              <option key={model.key} value={model.key}>
                {model.label}
              </option>
            ))}
          </select>
          <select
            class="t3-select"
            aria-label="Modus"
            value={store.composerRuntimeMode.value}
            onChange={(event) => {
              store.composerRuntimeMode.value = (event.target as HTMLSelectElement).value;
            }}
          >
            <option value="">Modus: Standard ({data.defaults.runtimeMode})</option>
            {RUNTIME_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        {isNew ? (
          <input
            class="t3-input"
            aria-label="Titel der Session"
            placeholder={defaultThreadTitle(context, template?.name)}
            value={store.composerTitle.value}
            onInput={(event) => {
              store.composerTitle.value = (event.target as HTMLInputElement).value;
            }}
          />
        ) : null}
      </div>
    </details>
  );
}

/** Setup and error states shown inside the drawer. */
function LinkProblem() {
  const error = store.loadError.value;
  const [code, setCode] = useState("");
  const [access, setAccess] = useState<"full-access" | "read-only">("full-access");
  if (!error) return null;
  if (error.code === "none" || error.code === "unpaired") {
    return (
      <div class="t3-setup">
        <div>
          <strong>T3 Code koppeln</strong>
          <div class="t3-muted">
            {error.code === "unpaired"
              ? "T3 Code läuft auf diesem Rechner. Einmalig koppeln, dann bleibt die Verbindung bestehen."
              : "Einmalig koppeln, dann bleibt die Verbindung bestehen."}
          </div>
        </div>
        <ol>
          <li>
            In T3 Code: <strong>Settings → Connections → Pair a client</strong>, oder im Terminal:
            <div class="t3-code">
              <code>t3 auth pairing create --ttl 10m --label Chrome</code>
              <button
                type="button"
                class="t3-btn small"
                onClick={() =>
                  void navigator.clipboard.writeText("t3 auth pairing create --ttl 10m --label Chrome")
                }
              >
                Kopieren
              </button>
            </div>
          </li>
          <li>
            Code hier einfügen:
            <input
              class="t3-input"
              placeholder="Pairing-Code"
              value={code}
              onInput={(event) => setCode((event.target as HTMLInputElement).value)}
            />
          </li>
          <li>
            <div class="t3-radio" role="radiogroup" aria-label="Zugriff">
              <label>
                <input
                  type="radio"
                  name="t3-access"
                  checked={access === "full-access"}
                  onChange={() => setAccess("full-access")}
                />
                Vollzugriff <span class="t3-muted">(empfohlen: darf pushen und kommentieren)</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="t3-access"
                  checked={access === "read-only"}
                  onChange={() => setAccess("read-only")}
                />
                Nur lesen
              </label>
            </div>
          </li>
        </ol>
        {store.setupError.value ? <Alert kind="error">{store.setupError.value}</Alert> : null}
        <div class="t3-row">
          <button
            type="button"
            class="t3-btn primary"
            disabled={!code.trim() || store.setupBusy.value}
            onClick={() => void store.pairFromPage(code.trim(), access)}
          >
            {store.setupBusy.value ? "Kopple…" : "Koppeln"}
          </button>
          <button
            type="button"
            class="t3-btn link"
            onClick={() => void sendRequest({ type: "options.open", tab: "connections" })}
          >
            Anderen Server verbinden
          </button>
        </div>
      </div>
    );
  }
  return (
    <Alert kind="error">
      <div>
        <strong>{error.code === "offline" ? "T3 Code läuft nicht" : "Fehler"}</strong>
        <div>{error.message}</div>
      </div>
      <div class="t3-row">
        <button type="button" class="t3-btn small" onClick={() => void store.retryLink()}>
          Erneut prüfen
        </button>
        <button
          type="button"
          class="t3-btn link"
          onClick={() => void sendRequest({ type: "options.open", tab: "connections" })}
        >
          Verbindungen
        </button>
      </div>
    </Alert>
  );
}
