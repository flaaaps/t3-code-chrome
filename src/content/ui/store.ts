import { computed, signal } from "@preact/signals";
import { errorCode, openLivePort, sendRequest } from "@shared/client";
import { suggestIntent } from "@shared/intent";
import {
  type CommentContext,
  DEFAULT_SETTINGS,
  type DispatchTarget,
  type ExtensionSettings,
  isActiveStatus,
  type LinkState,
  type PrContext,
  type PrOverview,
  type PromptTemplate,
  type ReviewOutput,
  type SendMode,
  type Session,
} from "@shared/models";
import { type PrKey, prKeyEquals } from "@shared/prKey";
import { BUILTIN_TEMPLATES } from "@shared/templates/builtin";
import { defaultThreadTitle, missingRequirements, renderTemplate } from "@shared/templates/render";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface LoadError {
  code: LinkState | "error";
  message: string;
}

export interface Toast {
  id: string;
  kind: "countdown" | "info" | "error";
  text: string;
  detail?: string;
  secondsLeft?: number;
  onCancel?: () => void;
  onAdjust?: () => void;
  session?: Session;
}

/** A target as presented in the composer's combobox. */
export type TargetChoice =
  | { kind: "session"; session: Session }
  | { kind: "thread"; threadId: string; envKey: string; title: string; status: string; projectTitle?: string }
  | { kind: "new"; envKey: string; projectId: string; projectTitle: string; workspace: "worktree" | "root" }
  | { kind: "scratch"; envKey: string }
  | { kind: "create-project"; envKey: string };

export const pr = signal<PrContext | undefined>(undefined);
export const status = signal<LoadStatus>("idle");
export const loadError = signal<LoadError | undefined>(undefined);
export const overview = signal<PrOverview | undefined>(undefined);
export const sessions = signal<Session[]>([]);
export const templates = signal<PromptTemplate[]>(BUILTIN_TEMPLATES);
export const settings = signal<ExtensionSettings>(DEFAULT_SETTINGS);
export const toast = signal<Toast | undefined>(undefined);
export const agentBoxCollapsed = signal(false);

export const composerOpen = signal(false);
export const composerIntentId = signal<string>("builtin:review");
export const composerNote = signal("");
export const composerComment = signal<CommentContext | undefined>(undefined);
export const composerTarget = signal<TargetChoice | undefined>(undefined);
export const composerSendMode = signal<SendMode>("queue");
export const composerReviewOutput = signal<ReviewOutput>("inline");
export const composerCustomPrompt = signal<string | undefined>(undefined);
export const composerModelKey = signal("");
export const composerRuntimeMode = signal("");
export const composerTitle = signal("");
export const composerSubmitting = signal(false);
export const composerError = signal<string | undefined>(undefined);
export const setupBusy = signal(false);
export const setupError = signal<string | undefined>(undefined);

let livePort: chrome.runtime.Port | undefined;
let toastTimer: ReturnType<typeof setInterval> | undefined;
let pendingOpen: (() => void) | undefined;

export const intent = computed(() => {
  const list = templates.value;
  return list.find((t) => t.id === composerIntentId.value) ?? list[0];
});

export const suggestedIntent = computed(() =>
  pr.value ? suggestIntent(pr.value, templates.value) : templates.value[0],
);

export const activeSessions = computed(() => sessions.value.filter((s) => isActiveStatus(s.status)));
export const waitingSessions = computed(() => sessions.value.filter((s) => s.status === "waiting"));

export const renderedPrompt = computed(() => {
  const template = intent.value;
  const context = pr.value;
  if (!template || !context) return "";
  return renderTemplate(template.body, {
    pr: { ...context, ...(composerComment.value ? { comment: composerComment.value } : {}) },
    note: composerNote.value,
    reviewOutput: composerReviewOutput.value,
    appendContextFooter: settings.value.appendContextFooter,
  });
});

export const prompt = computed(() => composerCustomPrompt.value ?? renderedPrompt.value);

export const missing = computed(() => {
  const template = intent.value;
  if (!template) return [];
  if (composerCustomPrompt.value?.trim()) return [];
  return missingRequirements(template, { note: composerNote.value, comment: composerComment.value });
});

// --- loading -------------------------------------------------------------

export function setPr(context: PrContext | undefined): void {
  const changed = !prKeyEquals(pr.value, context);
  pr.value = context;
  if (!context) {
    status.value = "idle";
    overview.value = undefined;
    sessions.value = [];
    closeLive();
    return;
  }
  if (changed) {
    overview.value = undefined;
    sessions.value = [];
    composerTarget.value = undefined;
    composerCustomPrompt.value = undefined;
    composerComment.value = undefined;
    composerNote.value = "";
    void load(false);
  }
}

export async function load(force: boolean): Promise<void> {
  const context = pr.value;
  if (!context) return;
  const key = prKey(context);
  status.value = "loading";
  try {
    const [{ templates: list }, { settings: current }] = await Promise.all([
      sendRequest({ type: "templates.list" }),
      sendRequest({ type: "settings.get" }),
    ]);
    templates.value = list;
    settings.value = current;
    composerReviewOutput.value = current.defaultReviewOutput;
    const data = await sendRequest({ type: "pr.overview", pr: key, force });
    if (!prKeyEquals(pr.value, context)) return;
    overview.value = data;
    sessions.value = data.sessions;
    loadError.value = undefined;
    status.value = "ready";
    if (!composerTarget.value) composerTarget.value = defaultTarget(data, context);
    composerIntentId.value = suggestIntent(context, list).id;
    ensureLive();
    pendingOpen?.();
    pendingOpen = undefined;
  } catch (error) {
    const code = errorCode(error);
    const mapped: LoadError["code"] =
      code === "no_connection"
        ? "none"
        : code === "unpaired" || code === "unauthenticated"
          ? "unpaired"
          : code === "unreachable"
            ? "offline"
            : "error";
    loadError.value = { code: mapped, message: (error as Error).message };
    status.value = "error";
  }
}

export async function refreshSessions(refresh = false): Promise<void> {
  const context = pr.value;
  if (!context || status.value !== "ready") return;
  try {
    const { sessions: list } = await sendRequest({ type: "pr.sessions", pr: prKey(context), refresh });
    if (prKeyEquals(pr.value, context)) sessions.value = mergeOptimistic(list);
  } catch {
    // keep what we have
  }
}

export function applySessionsEvent(all: Session[]): void {
  const context = pr.value;
  if (!context) return;
  const mine = all.filter((s) => prKeyEquals(s.pr, context));
  const linked = sessions.value.filter(
    (s) => s.source === "linked" && !mine.some((m) => m.threadId === s.threadId),
  );
  sessions.value = mergeOptimistic([...mine, ...linked]);
}

function mergeOptimistic(list: Session[]): Session[] {
  const optimistic = sessions.value.filter(
    (s) => s.optimistic && !list.some((l) => l.threadId === s.threadId),
  );
  return [...optimistic, ...list];
}

function ensureLive(): void {
  if (livePort) return;
  livePort = openLivePort("panel");
  livePort?.onDisconnect.addListener(() => {
    livePort = undefined;
  });
}

function closeLive(): void {
  livePort?.disconnect();
  livePort = undefined;
}

export function prKey(context: PrContext): PrKey {
  return { host: context.host, owner: context.owner, repo: context.repo, number: context.number };
}

// --- targets ---------------------------------------------------------------

export function defaultTarget(data: PrOverview, context: PrContext): TargetChoice | undefined {
  const envKey = data.defaults.envKey;
  if (!envKey) return undefined;
  if (data.defaults.projectId && data.defaults.projectTitle) {
    return {
      kind: "new",
      envKey,
      projectId: data.defaults.projectId,
      projectTitle: data.defaults.projectTitle,
      workspace: context.headBranch ? data.defaults.workspace : "root",
    };
  }
  return { kind: "scratch", envKey };
}

export function choiceEnvKey(choice: TargetChoice | undefined): string | undefined {
  if (!choice) return undefined;
  return choice.kind === "session" ? choice.session.envKey : choice.envKey;
}

export function targetLabel(choice: TargetChoice | undefined, context: PrContext | undefined): string {
  if (!choice) return "Ziel wählen…";
  switch (choice.kind) {
    case "session":
      return `${choice.session.title}`;
    case "thread":
      return choice.title;
    case "new":
      return choice.workspace === "worktree" && context?.headBranch
        ? `Neu in ${choice.projectTitle} · Worktree ${context.headBranch}`
        : `Neu in ${choice.projectTitle} · Projekt-Checkout`;
    case "scratch":
      return "Neu ohne Projekt (Scratch)";
    case "create-project":
      return "Projekt anlegen…";
  }
}

export function toDispatchTarget(choice: TargetChoice, context: PrContext): DispatchTarget | undefined {
  const modelKey = composerModelKey.value;
  const runtimeMode = composerRuntimeMode.value as DispatchTarget extends { runtimeMode?: infer R }
    ? R
    : never;
  const modelSelection = (() => {
    if (!modelKey) return undefined;
    const [instanceId, model] = modelKey.split("::");
    return instanceId && model ? { instanceId, model } : undefined;
  })();
  switch (choice.kind) {
    case "session":
      return {
        kind: "existing",
        envKey: choice.session.envKey,
        threadId: choice.session.threadId,
        sendMode: composerSendMode.value,
      };
    case "thread":
      return {
        kind: "existing",
        envKey: choice.envKey,
        threadId: choice.threadId,
        sendMode: composerSendMode.value,
      };
    case "new":
      return {
        kind: "new",
        envKey: choice.envKey,
        projectId: choice.projectId,
        workspace:
          choice.workspace === "worktree" && context.headBranch
            ? { type: "worktree", baseRef: context.headBranch, startFromOrigin: true }
            : { type: "root" },
        ...(modelSelection ? { modelSelection } : {}),
        ...(runtimeMode ? { runtimeMode } : {}),
        ...(composerTitle.value.trim() ? { title: composerTitle.value.trim() } : {}),
      };
    case "scratch":
      return {
        kind: "new",
        envKey: choice.envKey,
        scratch: true,
        workspace: { type: "root" },
        ...(modelSelection ? { modelSelection } : {}),
        ...(runtimeMode ? { runtimeMode } : {}),
      };
    case "create-project":
      return undefined;
  }
}

// --- composer --------------------------------------------------------------

export function openComposer(
  options: { intentId?: string; comment?: CommentContext; target?: TargetChoice } = {},
): void {
  const run = () => {
    if (options.intentId) composerIntentId.value = options.intentId;
    if (options.comment !== undefined) composerComment.value = options.comment;
    if (options.target) composerTarget.value = options.target;
    else if (!composerTarget.value && overview.value && pr.value)
      composerTarget.value = defaultTarget(overview.value, pr.value);
    // Templates that address an existing session prefer the PR's running session.
    const template = templates.value.find((t) => t.id === composerIntentId.value);
    if (!options.target && template?.defaultTarget === "existing") {
      const running = sessions.value.find((s) => isActiveStatus(s.status)) ?? sessions.value[0];
      if (running) composerTarget.value = { kind: "session", session: running };
    }
    composerError.value = undefined;
    composerOpen.value = true;
  };
  if (status.value === "ready" || status.value === "error") run();
  else {
    pendingOpen = run;
    composerOpen.value = true;
  }
}

export function closeComposer(): void {
  composerOpen.value = false;
  composerCustomPrompt.value = undefined;
}

export function selectIntent(id: string): void {
  composerIntentId.value = id;
  composerCustomPrompt.value = undefined;
  const template = templates.value.find((t) => t.id === id);
  if (template?.defaultSendMode) composerSendMode.value = template.defaultSendMode;
  if (template?.defaultTarget === "existing") {
    const running = sessions.value.find((s) => isActiveStatus(s.status)) ?? sessions.value[0];
    if (running) composerTarget.value = { kind: "session", session: running };
  } else if (
    template?.defaultTarget === "new" &&
    composerTarget.value &&
    (composerTarget.value.kind === "session" || composerTarget.value.kind === "thread")
  ) {
    if (overview.value && pr.value) composerTarget.value = defaultTarget(overview.value, pr.value);
  }
}

/** Send from the composer. */
export async function submitComposer(): Promise<void> {
  const context = pr.value;
  const choice = composerTarget.value;
  const template = intent.value;
  if (!context || !choice || !template) return;
  const target = toDispatchTarget(choice, context);
  if (!target) {
    composerError.value = "Bitte zuerst ein Projekt anlegen oder ein anderes Ziel wählen.";
    return;
  }
  const text = prompt.value.trim();
  if (!text || missing.value.length > 0) return;
  composerSubmitting.value = true;
  composerError.value = undefined;
  try {
    await dispatch(context, target, text, template);
    composerNote.value = "";
    composerCustomPrompt.value = undefined;
    composerComment.value = undefined;
    composerOpen.value = false;
  } catch (error) {
    composerError.value = (error as Error).message;
  } finally {
    composerSubmitting.value = false;
  }
}

async function dispatch(
  context: PrContext,
  target: DispatchTarget,
  text: string,
  template: PromptTemplate,
): Promise<Session> {
  const optimisticKey = `optimistic:${crypto.randomUUID()}`;
  const optimistic: Session = {
    key: optimisticKey,
    envKey: target.envKey,
    threadId: target.kind === "existing" ? target.threadId : optimisticKey,
    pr: prKey(context),
    title:
      target.kind === "new"
        ? defaultThreadTitle(context, template.name)
        : (sessions.value.find((s) => s.threadId === target.threadId)?.title ?? "Session"),
    intentName: template.name,
    status: "preparing",
    link: "",
    updatedAt: new Date().toISOString(),
    source: "job",
    optimistic: true,
  };
  if (target.kind === "new") sessions.value = [optimistic, ...sessions.value];
  try {
    const { session } = await sendRequest({
      type: "pr.dispatch",
      pr: context,
      target,
      prompt: text,
      intentId: template.id,
      intentName: template.name,
      ...(target.kind === "new" ? { title: defaultThreadTitle(context, template.name) } : {}),
      clientRequestId: crypto.randomUUID(),
    });
    sessions.value = [
      session,
      ...sessions.value.filter((s) => s.key !== optimisticKey && s.threadId !== session.threadId),
    ];
    showToast({
      id: crypto.randomUUID(),
      kind: "info",
      text: target.kind === "new" ? "Session gestartet" : "Gesendet",
      session,
    });
    void refreshSessions(true);
    return session;
  } catch (error) {
    sessions.value = sessions.value.filter((s) => s.key !== optimisticKey);
    throw error;
  }
}

// --- one-click action with countdown ------------------------------------------

export function quickDispatch(intentId: string): void {
  const context = pr.value;
  const data = overview.value;
  const template = templates.value.find((t) => t.id === intentId);
  if (!context || !template) return;
  if (status.value !== "ready" || !data) {
    openComposer({ intentId });
    return;
  }
  composerIntentId.value = intentId;
  composerCustomPrompt.value = undefined;
  const requirements = missingRequirements(template, {
    note: composerNote.value,
    comment: composerComment.value,
  });
  const choice =
    template.defaultTarget === "existing"
      ? (() => {
          const running = sessions.value.find((s) => isActiveStatus(s.status)) ?? sessions.value[0];
          return running
            ? ({ kind: "session", session: running } as TargetChoice)
            : defaultTarget(data, context);
        })()
      : defaultTarget(data, context);
  if (requirements.length > 0 || !choice || choice.kind === "scratch" || choice.kind === "create-project") {
    openComposer({ intentId, ...(choice ? { target: choice } : {}) });
    return;
  }
  composerTarget.value = choice;
  const target = toDispatchTarget(choice, context);
  if (!target) {
    openComposer({ intentId });
    return;
  }
  const text = renderTemplate(template.body, {
    pr: context,
    note: "",
    reviewOutput: composerReviewOutput.value,
    appendContextFooter: settings.value.appendContextFooter,
  });
  const seconds = settings.value.dispatchDelaySeconds;
  const run = () => {
    dismissToast();
    void dispatch(context, target, text, template).catch((error: Error) => {
      showToast({
        id: crypto.randomUUID(),
        kind: "error",
        text: "Senden fehlgeschlagen",
        detail: error.message,
      });
    });
  };
  if (seconds <= 0) {
    run();
    return;
  }
  const detail = `${template.actionLabel ?? template.name} · ${targetLabel(choice, context)}`;
  showToast({
    id: crypto.randomUUID(),
    kind: "countdown",
    text: `${template.actionLabel ?? template.name} startet in ${seconds} s`,
    detail,
    secondsLeft: seconds,
    onCancel: () => dismissToast(),
    onAdjust: () => {
      dismissToast();
      openComposer({ intentId, target: choice });
    },
  });
  let left = seconds;
  toastTimer = setInterval(() => {
    left -= 1;
    const current = toast.value;
    if (current?.kind !== "countdown") {
      if (toastTimer) clearInterval(toastTimer);
      return;
    }
    if (left <= 0) {
      run();
      return;
    }
    toast.value = {
      ...current,
      secondsLeft: left,
      text: `${template.actionLabel ?? template.name} startet in ${left} s`,
    };
  }, 1000);
}

export function showToast(next: Toast): void {
  if (toastTimer) clearInterval(toastTimer);
  toastTimer = undefined;
  toast.value = next;
  if (next.kind !== "countdown") {
    const id = next.id;
    setTimeout(
      () => {
        if (toast.value?.id === id) toast.value = undefined;
      },
      next.kind === "error" ? 12_000 : 6_000,
    );
  }
}

export function dismissToast(): void {
  if (toastTimer) clearInterval(toastTimer);
  toastTimer = undefined;
  toast.value = undefined;
}

// --- session actions ------------------------------------------------------------

function replaceSession(session: Session): void {
  const rest = sessions.value.filter((s) => s.threadId !== session.threadId);
  sessions.value = [session, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function replyToSession(
  session: Session,
  message: string,
  mode?: SendMode,
  requestId?: string,
): Promise<void> {
  const { session: next } = await sendRequest({
    type: "session.reply",
    envKey: session.envKey,
    threadId: session.threadId,
    message,
    ...(mode ? { mode } : {}),
    ...(requestId ? { requestId } : {}),
  });
  replaceSession(next);
}

export async function stopSession(session: Session): Promise<void> {
  const { session: next } = await sendRequest({
    type: "session.stop",
    envKey: session.envKey,
    threadId: session.threadId,
  });
  replaceSession(next);
}

export async function refreshSession(session: Session): Promise<void> {
  const { session: next } = await sendRequest({
    type: "session.refresh",
    envKey: session.envKey,
    threadId: session.threadId,
  });
  replaceSession(next);
}

export async function dismissSession(session: Session): Promise<void> {
  if (session.jobId) await sendRequest({ type: "session.dismiss", jobId: session.jobId });
  sessions.value = sessions.value.filter((s) => s.key !== session.key);
}

export async function openInT3(session: Session): Promise<void> {
  await sendRequest({ type: "thread.open", envKey: session.envKey, threadId: session.threadId });
}

// --- setup (pairing from the page) ------------------------------------------------

export async function pairFromPage(code: string, access: "full-access" | "read-only"): Promise<void> {
  setupBusy.value = true;
  setupError.value = undefined;
  try {
    const detected = await sendRequest({ type: "connections.autoDetect" });
    let id = detected.connection?.id;
    if (!id) {
      const list = await sendRequest({ type: "connections.list" });
      id = list.connections[0]?.id;
    }
    if (!id) throw new Error("Kein T3-Code-Server gefunden. Läuft die Desktop-App?");
    await sendRequest({ type: "connections.pairWithCode", id, code, access });
    await load(true);
  } catch (error) {
    setupError.value = (error as Error).message;
  } finally {
    setupBusy.value = false;
  }
}

export async function retryLink(): Promise<void> {
  await load(true);
}
