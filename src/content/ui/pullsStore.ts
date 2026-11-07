/**
 * State of the panels on the PR list. GitHub data (which PRs) and T3 data (which sessions) load
 * independently: the panels are useful without T3, and the badges fill in when T3 answers.
 */
import { computed, signal } from "@preact/signals";
import { errorCode, openLivePort, sendRequest } from "@shared/client";
import { isActiveStatus, type LinkState, type PrStack, type Session } from "@shared/models";
import { type PrKey, prKeyEquals, prKeyToString, type RepoKey, repoKeyEquals } from "@shared/prKey";
import {
  type PanelAssignment,
  type PanelId,
  type PrListItem,
  type PrPageFacts,
  prListItemToContext,
} from "@shared/pulls";
import { usesStackReview } from "@shared/templates/render";
import { clearPullsCache, loadBranches, loadPanels, loadPrFacts } from "../github/pullsPage";
import { branchStack, fetchStack } from "../github/stack";
import * as store from "./store";

export type PanelsStatus = "idle" | "loading" | "ready" | "error";
/** T3 side: "unknown" until the first answer. */
export type T3Link = LinkState | "unknown" | "error";

const COLLAPSED_KEY = "pullsPanelsCollapsed";
const SESSIONS_DEBOUNCE_MS = 400;

export const repo = signal<RepoKey | undefined>(undefined);
export const viewer = signal<string | undefined>(undefined);
export const status = signal<PanelsStatus>("idle");
export const error = signal<string | undefined>(undefined);
export const panels = signal<PanelAssignment | undefined>(undefined);
export const sessionsByPr = signal<Record<string, Session[]>>({});
export const t3Link = signal<T3Link>("unknown");
export const t3Error = signal<string | undefined>(undefined);
export const collapsed = signal(false);
/** Head/base branches per PR (from hovercards), used to group stacked PRs. */
export const branches = signal<Record<string, PrPageFacts>>({});
/** Stacks the user opened, by the key of the stack's bottom PR. Stacks start collapsed. */
export const expandedStacks = signal<ReadonlySet<string>>(new Set());
/** PR whose action is being prepared (branch lookup, project defaults). */
export const busyKey = signal<string | undefined>(undefined);

/** A one-click countdown is running; other rows wait for it (the store holds one active PR). */
export const countdownActive = computed(() => store.toast.value?.kind === "countdown");

export const allSessions = computed(() => Object.values(sessionsByPr.value).flat());
export const waitingCount = computed(() => allSessions.value.filter((s) => s.status === "waiting").length);
export const runningCount = computed(
  () => allSessions.value.filter((s) => isActiveStatus(s.status) && s.status !== "waiting").length,
);

let generation = 0;
let livePort: chrome.runtime.Port | undefined;
let sessionsTimer: ReturnType<typeof setTimeout> | undefined;

export function sessionsFor(item: PrKey): Session[] {
  return sessionsByPr.value[prKeyToString(item)] ?? [];
}

// --- lifecycle -----------------------------------------------------------------------------

export function activate(next: RepoKey, login: string): void {
  if (repoKeyEquals(repo.value, next) && viewer.value === login && status.value !== "idle") return;
  generation += 1;
  repo.value = next;
  viewer.value = login;
  panels.value = undefined;
  sessionsByPr.value = {};
  branches.value = {};
  expandedStacks.value = new Set();
  t3Link.value = "unknown";
  store.composerShowsPr.value = true;
  void chrome.storage.local
    .get(COLLAPSED_KEY)
    .then((result) => {
      collapsed.value = result[COLLAPSED_KEY] === true;
    })
    .catch(() => undefined);
  void loadSupport();
  void reload(false);
}

export function deactivate(): void {
  generation += 1;
  repo.value = undefined;
  viewer.value = undefined;
  status.value = "idle";
  panels.value = undefined;
  sessionsByPr.value = {};
  busyKey.value = undefined;
  store.composerShowsPr.value = false;
  if (sessionsTimer) clearTimeout(sessionsTimer);
  closeLive();
}

/** Templates and settings for the row buttons; the PR store loads them again per PR. */
async function loadSupport(): Promise<void> {
  try {
    const [{ templates }, { settings }] = await Promise.all([
      sendRequest({ type: "templates.list" }),
      sendRequest({ type: "settings.get" }),
    ]);
    store.templates.value = templates;
    store.settings.value = settings;
  } catch {
    // built-in defaults stay in place
  }
}

export async function reload(force: boolean): Promise<void> {
  const current = repo.value;
  if (!current) return;
  const run = generation;
  if (force) clearPullsCache();
  if (force || !panels.value) status.value = "loading";
  try {
    const data = await loadPanels(current, force);
    if (run !== generation) return;
    panels.value = data;
    error.value = undefined;
    status.value = "ready";
    void loadStackBranches(run);
    await refreshSessions(force);
  } catch (err) {
    if (run !== generation) return;
    error.value = (err as Error).message;
    status.value = "error";
  }
}

/** Branches arrive after the rows; stacks regroup once, when all are known. */
async function loadStackBranches(run: number): Promise<void> {
  const keys = visibleKeys();
  if (keys.length < 2) return;
  const result = await loadBranches(keys).catch(() => ({}));
  if (run === generation) branches.value = result;
}

export function toggleStack(key: string): void {
  const next = new Set(expandedStacks.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedStacks.value = next;
}

function visibleKeys(): PrKey[] {
  const data = panels.value;
  if (!data) return [];
  return [...data.review, ...data.mine].map(({ host, owner, repo: name, number }) => ({
    host,
    owner,
    repo: name,
    number,
  }));
}

export async function refreshSessions(refresh = false): Promise<void> {
  const keys = visibleKeys();
  if (keys.length === 0) {
    sessionsByPr.value = {};
    return;
  }
  const run = generation;
  try {
    const { sessions } = await sendRequest({ type: "prs.sessions", prs: keys.slice(0, 100), refresh });
    if (run !== generation) return;
    sessionsByPr.value = sessions;
    t3Link.value = "ready";
    t3Error.value = undefined;
    syncLive();
  } catch (err) {
    if (run !== generation) return;
    const code = errorCode(err);
    t3Link.value =
      code === "no_connection"
        ? "none"
        : code === "unpaired" || code === "unauthenticated"
          ? "unpaired"
          : code === "unreachable"
            ? "offline"
            : "error";
    t3Error.value = (err as Error).message;
    closeLive();
  }
}

/** The worker reports changed jobs; refetch the badges (cheap, the worker caches the listing). */
export function onSessionsChanged(): void {
  if (!repo.value || status.value !== "ready") return;
  if (sessionsTimer) clearTimeout(sessionsTimer);
  sessionsTimer = setTimeout(() => void refreshSessions(false), SESSIONS_DEBOUNCE_MS);
}

export function onConnectionsChanged(): void {
  if (!repo.value || status.value !== "ready") return;
  void refreshSessions(true);
}

/** Keep the worker polling quickly while a session shown here is still active. */
function syncLive(): void {
  const active = allSessions.value.some((s) => isActiveStatus(s.status));
  if (active && !livePort) {
    livePort = openLivePort("panel");
    livePort?.onDisconnect.addListener(() => {
      livePort = undefined;
    });
  } else if (!active) {
    closeLive();
  }
}

function closeLive(): void {
  livePort?.disconnect();
  livePort = undefined;
}

export function setCollapsed(value: boolean): void {
  collapsed.value = value;
  void chrome.storage.local.set({ [COLLAPSED_KEY]: value }).catch(() => undefined);
}

// --- row actions ------------------------------------------------------------------------------

/**
 * The stack a list row belongs to: a native GitHub stack (the list marks it) from the PR page,
 * otherwise PRs chained by branches.
 */
async function stackFor(item: PrListItem, title: string): Promise<PrStack | undefined> {
  if (item.stack) {
    const native = await fetchStack(item);
    if (native) return native;
  }
  return branchStack({ host: item.host, owner: item.owner, repo: item.repo, number: item.number, title });
}

/**
 * Turn a list row into the active PR: read its branch from the PR page, then let the PR store load
 * projects and sessions. The stack is looked up alongside; with `awaitStack` the PR becomes active
 * with it (a one-click stack review needs it), otherwise it is added when it arrives. Returns false
 * when T3 is not usable (the composer then explains why).
 */
async function prepare(item: PrListItem, awaitStack: boolean): Promise<boolean> {
  const key = prKeyToString(item);
  busyKey.value = key;
  try {
    const facts = await loadPrFacts(item);
    const context = prListItemToContext(item, viewer.value, facts);
    const stackLookup = stackFor(item, context.title);
    const addStack = (stack: PrStack | undefined) => {
      const current = store.pr.value;
      if (stack && current && prKeyEquals(current, item)) store.pr.value = { ...current, stack };
    };
    if (!awaitStack) void stackLookup.then(addStack);
    const [ready, stack] = await Promise.all([
      store.activateContext(context),
      awaitStack ? stackLookup : Promise.resolve(undefined),
    ]);
    addStack(stack);
    // Seed the PR store with what the list already knows, so the composer offers the right sessions.
    if (ready) store.sessions.value = mergeSessions(store.sessions.value, sessionsFor(item));
    return ready;
  } finally {
    if (busyKey.value === key) busyKey.value = undefined;
  }
}

function mergeSessions(primary: Session[], extra: Session[]): Session[] {
  const known = new Set(primary.map((s) => s.threadId));
  return [...primary, ...extra.filter((s) => !known.has(s.threadId))];
}

export async function runIntent(item: PrListItem, intentId: string): Promise<void> {
  if (busyKey.value || countdownActive.value) return;
  const template = store.templates.value.find((t) => t.id === intentId);
  const reviewsStack = !!template && usesStackReview(template) && store.composerReviewStack.value;
  const ready = await prepare(item, reviewsStack);
  if (!ready) {
    store.openComposer({ intentId });
    return;
  }
  store.quickDispatch(intentId, { detailPrefix: `#${item.number}` });
}

export async function openComposerFor(item: PrListItem, intentId: string): Promise<void> {
  if (busyKey.value) return;
  await prepare(item, false);
  store.openComposer({ intentId });
}

export async function openSession(session: Session): Promise<void> {
  try {
    await store.openInT3(session);
  } catch (err) {
    store.showToast({
      id: crypto.randomUUID(),
      kind: "error",
      text: "Session konnte nicht geöffnet werden",
      detail: (err as Error).message,
    });
  }
}

/** Composer for the pairing flow, anchored on the first visible PR (it needs a PR context). */
export async function openSetup(): Promise<void> {
  const first = panels.value?.review[0] ?? panels.value?.mine[0];
  if (first) {
    await store.setPr(prListItemToContext(first, viewer.value));
    store.openComposer();
    return;
  }
  await sendRequest({ type: "options.open" }).catch(() => undefined);
}

export function panelItems(panel: PanelId): PrListItem[] {
  return panels.value?.[panel] ?? [];
}
