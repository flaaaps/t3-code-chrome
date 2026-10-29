import { sendRequest } from "@shared/client";
import {
  ACTIVE_THREAD_STATUSES,
  type DispatchTarget,
  type ExtensionSettings,
  type Job,
  type ModelSelection,
  type PrContext,
  type PromptTemplate,
  type PrSuggestions,
  type RuntimeMode,
  type SendMode,
  type ThreadSummary,
} from "@shared/models";
import { threadMentionsPr, threadMentionsPrInTitle } from "@shared/sort";
import { defaultThreadTitle, renderTemplate } from "@shared/templates/render";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Alert, relativeTime, Spinner, StatusChip } from "./components";
import { JobList } from "./JobList";

export interface PanelProps {
  pr: PrContext;
  open: boolean;
  initialSelection?: string;
  selectionVersion: number;
  jobs: Job[];
  onJobs: (jobs: Job[]) => void;
  onClose: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; code?: string; message: string }
  | { kind: "ready"; suggestions: PrSuggestions; templates: PromptTemplate[]; settings: ExtensionSettings };

const RUNTIME_MODES: Array<{ value: RuntimeMode; label: string }> = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "approval-required", label: "Approval required" },
];

const SEND_MODES: Array<{ value: SendMode; label: string; hint: string }> = [
  { value: "queue", label: "Als nächsten Turn", hint: "läuft nach dem aktuellen Turn" },
  { value: "steer", label: "Sofort einsteuern", hint: "unterbricht nicht, lenkt den laufenden Turn" },
  { value: "restart", label: "Neu starten", hint: "bricht den laufenden Turn ab" },
  { value: "auto", label: "Automatisch", hint: "T3 wählt passend" },
];

export function Panel(props: PanelProps) {
  const { pr, open, onClose } = props;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [templateId, setTemplateId] = useState<string>("builtin:review");
  const [targetKind, setTargetKind] = useState<"new" | "existing">("new");
  const [envKey, setEnvKey] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [workspace, setWorkspace] = useState<"worktree" | "root">("worktree");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode | "">("");
  const [modelKey, setModelKey] = useState<string>("");
  const [threadId, setThreadId] = useState<string>("");
  const [threadFilter, setThreadFilter] = useState("");
  const [onlyThisPr, setOnlyThisPr] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>("queue");
  const [note, setNote] = useState("");
  const [selection, setSelection] = useState(props.initialSelection ?? "");
  const [customPrompt, setCustomPrompt] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [lastJob, setLastJob] = useState<Job | undefined>(undefined);
  const loadedFor = useRef<string | undefined>(undefined);

  const prKeyString = `${pr.owner}/${pr.repo}#${pr.number}`;

  const load = async (force = false) => {
    setState({ kind: "loading" });
    try {
      const [suggestions, { templates }, { settings }] = await Promise.all([
        sendRequest({
          type: "pr.suggestions",
          pr: { host: pr.host, owner: pr.owner, repo: pr.repo, number: pr.number },
          force,
        }),
        sendRequest({ type: "templates.list" }),
        sendRequest({ type: "settings.get" }),
      ]);
      setState({ kind: "ready", suggestions, templates, settings });
      props.onJobs(suggestions.jobs);
      if (loadedFor.current !== prKeyString) {
        loadedFor.current = prKeyString;
        setEnvKey(suggestions.defaultEnvKey ?? suggestions.environments[0]?.key ?? "");
        setProjectId(suggestions.suggestedProjectId ?? "");
        setWorkspace(settings.defaultWorkspace);
        setRuntimeMode("");
        if (suggestions.suggestedThreadId) {
          setThreadId(suggestions.suggestedThreadId);
          setOnlyThisPr(true);
        }
      }
    } catch (error) {
      const err = error as Error & { code?: string };
      setState({ kind: "error", message: err.message, ...(err.code ? { code: err.code } : {}) });
    }
  };

  useEffect(() => {
    if (open) void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prKeyString]);

  useEffect(() => {
    if (props.initialSelection !== undefined) {
      setSelection(props.initialSelection);
      if (props.initialSelection.trim().length > 0) {
        setTemplateId("builtin:reply-comment");
        setTargetKind("existing");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectionVersion]);

  const ready = state.kind === "ready" ? state : undefined;
  const templates = ready?.templates ?? [];
  const template = templates.find((t) => t.id === templateId) ?? templates[0];

  useEffect(() => {
    if (!template) return;
    setCustomPrompt(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  const environments = ready?.suggestions.environments.filter((e) => e.reachable) ?? [];
  const projects = ready?.suggestions.projects.filter((p) => p.envKey === envKey) ?? [];
  const allThreads = ready?.suggestions.threads.filter((t) => t.envKey === envKey) ?? [];
  const capabilities = ready?.suggestions.capabilities[envKey];
  const prKey = { host: pr.host, owner: pr.owner, repo: pr.repo, number: pr.number };

  const threads = useMemo(() => {
    const filter = threadFilter.trim().toLowerCase();
    return allThreads.filter((t) => {
      if (onlyThisPr && !(threadMentionsPr(t, prKey) || threadMentionsPrInTitle(t, prKey))) return false;
      if (filter && !t.title.toLowerCase().includes(filter) && !t.threadId.toLowerCase().includes(filter))
        return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allThreads, threadFilter, onlyThisPr, prKeyString]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const modelOptions = useMemo(() => {
    const list: Array<{ key: string; label: string; selection: ModelSelection }> = [];
    for (const provider of capabilities?.providers ?? []) {
      for (const model of provider.models) {
        list.push({
          key: `${provider.providerInstanceId}::${model.id}`,
          label: `${provider.displayName} · ${model.label ?? model.id}`,
          selection: { instanceId: provider.providerInstanceId, model: model.id },
        });
      }
    }
    return list;
  }, [capabilities]);

  const renderedPrompt = useMemo(() => {
    if (!template) return "";
    return renderTemplate(template.body, {
      pr,
      note,
      selection,
      appendContextFooter: ready?.settings.appendContextFooter ?? true,
    });
  }, [template, pr, note, selection, ready?.settings.appendContextFooter]);
  const prompt = customPrompt ?? renderedPrompt;

  const effectiveTarget = (): DispatchTarget | undefined => {
    if (targetKind === "existing") {
      if (!threadId) return undefined;
      return { kind: "existing", envKey, threadId, sendMode };
    }
    const headBranch = pr.headBranch;
    const useWorktree = workspace === "worktree" && !!headBranch;
    const target: DispatchTarget = {
      kind: "new",
      envKey,
      workspace: useWorktree
        ? { type: "worktree", baseRef: headBranch, startFromOrigin: true }
        : { type: "root" },
      ...(projectId === "__scratch__" ? { scratch: true } : { projectId }),
      ...(runtimeMode ? { runtimeMode } : {}),
    };
    const model = modelOptions.find((m) => m.key === modelKey);
    if (model) target.modelSelection = model.selection;
    if (!target.scratch && !target.projectId) return undefined;
    return target;
  };

  const submit = async () => {
    const target = effectiveTarget();
    if (!target || !prompt.trim()) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const { job } = await sendRequest({
        type: "pr.dispatch",
        pr: { ...pr, selection },
        target,
        prompt,
        ...(target.kind === "new" ? { title: title.trim() || defaultThreadTitle(pr, template?.name) } : {}),
        clientRequestId: crypto.randomUUID(),
      });
      setLastJob(job);
      setNote("");
      setCustomPrompt(undefined);
      const { jobs } = await sendRequest({ type: "jobs.list", pr: prKey });
      props.onJobs(jobs);
      if (target.kind === "new") {
        setTargetKind("existing");
        setThreadId(job.threadId);
      }
      void load(true);
    } catch (error) {
      setSubmitError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && !!effectiveTarget() && prompt.trim().length > 0 && !!envKey;

  return (
    <div class="t3-overlay">
      <section class="t3-panel" hidden={!open} aria-label="T3 Code">
        <header class="t3-header">
          <h2>
            <span class="t3-logo">T3</span> T3 Code
          </h2>
          <button type="button" class="t3-icon-btn" title="Neu laden" onClick={() => void load(true)}>
            ↻
          </button>
          <button
            type="button"
            class="t3-icon-btn"
            title="Optionen"
            onClick={() => void sendRequest({ type: "options.open" })}
          >
            ⚙
          </button>
          <button type="button" class="t3-icon-btn" title="Schließen (Esc)" onClick={onClose}>
            ✕
          </button>
        </header>

        <div class="t3-body">
          <div class="t3-pr">
            <strong>
              {pr.owner}/{pr.repo}#{pr.number}
            </strong>{" "}
            {pr.title}
            {pr.headBranch ? (
              <div>
                <code>{pr.headBranch}</code> → <code>{pr.baseBranch ?? "?"}</code>
              </div>
            ) : null}
          </div>

          {state.kind === "loading" ? (
            <div class="t3-center">
              <Spinner /> Lade Projekte und Sessions…
            </div>
          ) : null}

          {state.kind === "error" ? (
            <Alert kind="error">
              <div>{state.message}</div>
              <div class="t3-row">
                {state.code === "unauthenticated" || state.code === "unreachable" ? (
                  <button
                    type="button"
                    class="t3-btn small fixed"
                    onClick={() => void sendRequest({ type: "options.open" })}
                  >
                    Optionen öffnen
                  </button>
                ) : null}
                <button type="button" class="t3-btn small fixed" onClick={() => void load(true)}>
                  Erneut versuchen
                </button>
              </div>
            </Alert>
          ) : null}

          {lastJob ? (
            <Alert kind="success">
              <div>
                Gesendet an <strong>{lastJob.threadTitle}</strong> <StatusChip status={lastJob.status} />
              </div>
              <div class="t3-row">
                <button
                  type="button"
                  class="t3-btn small fixed"
                  onClick={() =>
                    void sendRequest({
                      type: "thread.open",
                      envKey: lastJob.envKey,
                      threadId: lastJob.threadId,
                      link: lastJob.link,
                    })
                  }
                >
                  In T3 öffnen
                </button>
                <button type="button" class="t3-btn link fixed" onClick={() => setLastJob(undefined)}>
                  Ausblenden
                </button>
              </div>
            </Alert>
          ) : null}

          {ready ? (
            <>
              <JobList jobs={props.jobs} onChanged={props.onJobs} />

              <div class="t3-section">
                <div class="t3-label">Vorlage</div>
                <div class="t3-chips">
                  {templates.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      class={`t3-chip ${t.id === template?.id ? "active" : ""}`}
                      title={t.description ?? ""}
                      onClick={() => {
                        setTemplateId(t.id);
                        if (t.defaultTarget === "existing" && threads.length > 0) setTargetKind("existing");
                        else if (t.defaultTarget === "new") setTargetKind("new");
                        if (t.defaultSendMode) setSendMode(t.defaultSendMode);
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              <div class="t3-section">
                <div class="t3-label">
                  Ziel
                  {environments.length > 1 ? (
                    <select
                      class="t3-select"
                      style="width:auto;max-width:200px"
                      value={envKey}
                      onChange={(e) => {
                        setEnvKey((e.target as HTMLSelectElement).value);
                        setProjectId("");
                        setThreadId("");
                      }}
                    >
                      {environments.map((env) => (
                        <option key={env.key} value={env.key}>
                          {env.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span class="hint">{environments[0]?.label}</span>
                  )}
                </div>
                <div class="t3-segment">
                  <button
                    type="button"
                    class={targetKind === "new" ? "active" : ""}
                    onClick={() => setTargetKind("new")}
                  >
                    Neue Session
                  </button>
                  <button
                    type="button"
                    class={targetKind === "existing" ? "active" : ""}
                    onClick={() => setTargetKind("existing")}
                  >
                    Bestehende Session {allThreads.length > 0 ? `(${allThreads.length})` : ""}
                  </button>
                </div>
              </div>

              {targetKind === "new" ? (
                <>
                  <div class="t3-section">
                    <div class="t3-label">
                      Projekt
                      {ready.suggestions.suggestedProjectId &&
                      projectId === ready.suggestions.suggestedProjectId ? (
                        <span class="hint">passend zum Repo erkannt</span>
                      ) : null}
                    </div>
                    <select
                      class="t3-select"
                      value={projectId}
                      onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}
                    >
                      <option value="">– Projekt wählen –</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                          {p.repoDisplayName ? ` (${p.repoDisplayName})` : ""}
                        </option>
                      ))}
                      <option value="__scratch__">Ohne Projekt (Scratch-Ordner)</option>
                    </select>
                    {!ready.suggestions.suggestedProjectId ? (
                      <div class="t3-muted">
                        Kein T3-Projekt mit Repository {pr.owner}/{pr.repo} gefunden. Wähle manuell oder lege
                        das Projekt in T3 an.
                      </div>
                    ) : null}
                  </div>

                  {projectId && projectId !== "__scratch__" ? (
                    <div class="t3-section">
                      <div class="t3-label">Arbeitsverzeichnis</div>
                      <div class="t3-segment">
                        <button
                          type="button"
                          class={workspace === "worktree" ? "active" : ""}
                          disabled={!pr.headBranch}
                          title={
                            pr.headBranch ? `Neuer Worktree auf ${pr.headBranch}` : "PR-Branch nicht erkannt"
                          }
                          onClick={() => setWorkspace("worktree")}
                        >
                          Worktree auf PR-Branch
                        </button>
                        <button
                          type="button"
                          class={workspace === "root" ? "active" : ""}
                          onClick={() => setWorkspace("root")}
                        >
                          Projekt-Checkout
                        </button>
                      </div>
                      {workspace === "worktree" && pr.headBranch ? (
                        <div class="t3-muted">
                          Neuer Worktree ab <code>origin/{pr.headBranch}</code>; der Checkout in{" "}
                          {selectedProject?.title} bleibt unberührt.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <details class="t3-details">
                    <summary>Modell, Modus, Titel</summary>
                    <div class="content">
                      <div class="t3-row">
                        <select
                          class="t3-select"
                          value={modelKey}
                          onChange={(e) => setModelKey((e.target as HTMLSelectElement).value)}
                        >
                          <option value="">
                            Standardmodell
                            {selectedProject?.defaultModelSelection
                              ? ` (${selectedProject.defaultModelSelection.model})`
                              : ""}
                          </option>
                          {modelOptions.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <select
                          class="t3-select"
                          value={runtimeMode}
                          onChange={(e) =>
                            setRuntimeMode((e.target as HTMLSelectElement).value as RuntimeMode | "")
                          }
                        >
                          <option value="">Modus: Standard ({ready.settings.defaultRuntimeMode})</option>
                          {RUNTIME_MODES.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <input
                        class="t3-input"
                        placeholder={defaultThreadTitle(pr, template?.name)}
                        value={title}
                        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                      />
                    </div>
                  </details>
                </>
              ) : (
                <div class="t3-section">
                  <div class="t3-row">
                    <input
                      class="t3-input"
                      placeholder="Sessions filtern…"
                      value={threadFilter}
                      onInput={(e) => setThreadFilter((e.target as HTMLInputElement).value)}
                    />
                    <label
                      class="t3-muted fixed"
                      style="display:flex;align-items:center;gap:4px;cursor:pointer"
                    >
                      <input
                        type="checkbox"
                        checked={onlyThisPr}
                        onChange={(e) => setOnlyThisPr((e.target as HTMLInputElement).checked)}
                      />
                      nur diese PR
                    </label>
                  </div>
                  <ThreadPicker
                    threads={threads}
                    projectsById={new Map(projects.map((p) => [p.id, p.title]))}
                    selected={threadId}
                    pr={prKey}
                    onSelect={setThreadId}
                  />
                  <div class="t3-row">
                    <select
                      class="t3-select"
                      value={sendMode}
                      onChange={(e) => setSendMode((e.target as HTMLSelectElement).value as SendMode)}
                    >
                      {SEND_MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label} – {m.hint}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div class="t3-section">
                <div class="t3-label">
                  Hinweis für den Agenten <span class="hint">optional</span>
                </div>
                <textarea
                  class="t3-textarea"
                  placeholder="Zusätzliche Anweisungen, Fokus, Kontext…"
                  value={note}
                  onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
                />
              </div>

              {selection ? (
                <div class="t3-section">
                  <div class="t3-label">
                    Ausgewählter Kommentar
                    <button type="button" class="t3-btn link" onClick={() => setSelection("")}>
                      entfernen
                    </button>
                  </div>
                  <textarea
                    class="t3-textarea mono"
                    value={selection}
                    onInput={(e) => setSelection((e.target as HTMLTextAreaElement).value)}
                  />
                </div>
              ) : null}

              <details class="t3-details">
                <summary>Prompt-Vorschau {customPrompt !== undefined ? "(manuell bearbeitet)" : ""}</summary>
                <div class="content">
                  <textarea
                    class="t3-textarea mono"
                    value={prompt}
                    onInput={(e) => setCustomPrompt((e.target as HTMLTextAreaElement).value)}
                  />
                  {customPrompt !== undefined ? (
                    <button type="button" class="t3-btn link" onClick={() => setCustomPrompt(undefined)}>
                      Auf Vorlage zurücksetzen
                    </button>
                  ) : null}
                </div>
              </details>

              {submitError ? <Alert kind="error">{submitError}</Alert> : null}
            </>
          ) : null}
        </div>

        <footer class="t3-footer">
          <span class="t3-muted" style="flex:1">
            {targetKind === "new"
              ? "Startet einen neuen Thread in T3 Code."
              : threadId
                ? "Sendet an die ausgewählte Session."
                : "Wähle eine Session aus."}
          </span>
          <button type="button" class="t3-btn primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? "Sende…" : targetKind === "new" ? "Session starten" : "Senden"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ThreadPicker({
  threads,
  projectsById,
  selected,
  pr,
  onSelect,
}: {
  threads: ThreadSummary[];
  projectsById: Map<string, string>;
  selected: string;
  pr: { host: string; owner: string; repo: string; number: number };
  onSelect: (threadId: string) => void;
}) {
  if (threads.length === 0) {
    return (
      <div class="t3-muted">Keine passenden Sessions. Starte eine neue Session oder ändere den Filter.</div>
    );
  }
  return (
    <div class="t3-threads" role="listbox">
      {threads.slice(0, 60).map((thread) => {
        const linked = threadMentionsPr(thread, pr) || threadMentionsPrInTitle(thread, pr);
        const active = ACTIVE_THREAD_STATUSES.has(thread.status);
        return (
          <button
            type="button"
            role="option"
            aria-selected={thread.threadId === selected}
            key={thread.threadId}
            class={`t3-thread ${thread.threadId === selected ? "active" : ""}`}
            onClick={() => onSelect(thread.threadId)}
          >
            <div class="main">
              <div class="title">{thread.title}</div>
              <div class="meta">
                {linked ? <StatusChip status="pr">diese PR</StatusChip> : null}
                <StatusChip status={thread.status} />
                <span>{projectsById.get(thread.projectId) ?? "–"}</span>
                <span>{relativeTime(thread.updatedAt)}</span>
                {thread.model ? <span>{thread.model}</span> : null}
                {active ? <span>· aktiv</span> : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
