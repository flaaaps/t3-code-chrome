import { type ExtensionEvent, sendRequest } from "@shared/client";
import type { PrContext, PrStack } from "@shared/models";
import type { PrLocation, RepoKey } from "@shared/prKey";
import { matchesShortcut, parseShortcut } from "@shared/shortcut";
import { h, render } from "preact";
import {
  type Anchor,
  commentMenuSlot,
  findAgentBoxAnchor,
  findCommentActionContainers,
  findCommentRoot,
  findHeaderActions,
  findTitleRow,
  isIssueBody,
} from "./github/mountPoints";
import { commentFromSelection, describeComment, readPrContext } from "./github/prContext";
import { watchLocation } from "./github/prDetector";
import { findPullsAnchor, readViewer } from "./github/pullsPage";
import { branchStack, fetchStack, hasStackBadge, stackFromPage } from "./github/stack";
import { AgentBox } from "./ui/AgentBox";
import { CommentMenu } from "./ui/CommentMenu";
import { Composer } from "./ui/Composer";
import { HeaderAction } from "./ui/HeaderAction";
import { isolateKeyboard } from "./ui/keyboard";
import { PullsPanels } from "./ui/PullsPanels";
import * as pulls from "./ui/pullsStore";
import * as store from "./ui/store";
import { PANEL_STYLES } from "./ui/styles";
import { Toast } from "./ui/Toast";

const OVERLAY_ID = "t3-code-chrome-host";
const HEADER_ID = "t3-code-chrome-trigger";
const AGENTBOX_ID = "t3-code-chrome-agentbox";
const COMMENT_CLASS = "t3-code-chrome-comment";
const PULLS_ID = "t3-code-chrome-pulls";

let currentPr: PrLocation | undefined;
let currentStack: PrStack | undefined;
/** Reading the stack: the page's embedded data first, then a fetch once GitHub's stack badge shows. */
let stackPhase: "page" | "badge" | "done" = "page";
let currentPulls: RepoKey | undefined;
let pullsActivation = 0;
let observer: MutationObserver | undefined;
let mountScheduled = false;
let rereadTimer: number | undefined;

interface Host {
  element: HTMLElement;
  root: HTMLElement;
}

function makeHost(id: string, tag: "div" | "span" = "div"): Host {
  const element = document.createElement(tag);
  element.id = id;
  const shadow = element.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_STYLES;
  shadow.appendChild(style);
  const root = document.createElement(tag === "span" ? "span" : "div");
  shadow.appendChild(root);
  isolateKeyboard(element);
  return { element, root };
}

// --- overlay (composer + toast), lives on body ----------------------------------

let overlay: Host | undefined;

function Overlay() {
  return h("div", null, h(Composer, { returnFocusTo: focusTrigger }), h(Toast, null));
}

function mountOverlay(): void {
  if (overlay?.element.isConnected) return;
  overlay = makeHost(OVERLAY_ID);
  document.body.appendChild(overlay.element);
  render(h(Overlay, null), overlay.root);
}

function unmountOverlay(): void {
  if (!overlay) return;
  render(null, overlay.root);
  overlay.element.remove();
  overlay = undefined;
}

// --- header action -------------------------------------------------------------------

let header: Host | undefined;

function focusTrigger(): void {
  const button = header?.root.querySelector<HTMLButtonElement>(".t3-split > button, .t3-btn");
  button?.focus();
}

function jumpToSessions(): void {
  store.agentBoxCollapsed.value = false;
  agentBox?.element.scrollIntoView({ behavior: "smooth", block: "center" });
}

function mountHeader(): void {
  if (header?.element.isConnected) return;
  header?.element.remove();
  header = makeHost(HEADER_ID, "span");
  header.element.style.display = "inline-flex";
  header.element.style.verticalAlign = "middle";
  const actions = findHeaderActions();
  if (actions) {
    // The new PR experience's action row spaces its children with `gap`.
    if (getComputedStyle(actions).columnGap === "normal") header.element.style.marginLeft = "8px";
    actions.appendChild(header.element);
  } else {
    // Logged-out or unexpected layout: a right-aligned row under the PR header instead of a floating button.
    const anchor = findAgentBoxAnchor();
    header.element.style.display = "flex";
    header.element.style.justifyContent = "flex-end";
    header.element.style.margin = "8px 0";
    if (anchor) insertAt(anchor, header.element);
    else findTitleRow()?.insertAdjacentElement("afterend", header.element);
  }
  render(h(HeaderAction, { onJumpToSessions: jumpToSessions }), header.root);
}

// --- agent box ----------------------------------------------------------------------

let agentBox: Host | undefined;

function mountAgentBox(): void {
  if (agentBox?.element.isConnected) return;
  agentBox?.element.remove();
  const anchor = findAgentBoxAnchor();
  if (!anchor) return;
  agentBox = makeHost(AGENTBOX_ID);
  agentBox.element.style.display = "block";
  if (anchor.position === "append") {
    // Inside the new PR experience's page header: same width as the content, gap below the tabs.
    agentBox.element.style.maxWidth = "1356px";
    agentBox.element.style.margin = "16px auto 0";
  }
  insertAt(anchor, agentBox.element);
  render(h(AgentBox, null), agentBox.root);
}

function insertAt(anchor: Anchor, element: HTMLElement): void {
  if (anchor.position === "append") anchor.node.appendChild(element);
  else anchor.node.insertAdjacentElement(anchor.position === "after" ? "afterend" : "beforebegin", element);
}

// --- comment menus ---------------------------------------------------------------------

function mountCommentMenus(): void {
  for (const container of findCommentActionContainers()) {
    if (container.querySelector(`.${COMMENT_CLASS}`)) continue;
    const root = findCommentRoot(container);
    if (!root || isIssueBody(root)) continue;
    const host = makeHost(`${COMMENT_CLASS}-${Math.random().toString(36).slice(2, 8)}`, "span");
    host.element.className = COMMENT_CLASS;
    host.element.removeAttribute("id");
    host.element.style.display = "inline-flex";
    host.element.style.position = "relative";
    const slot = commentMenuSlot(container);
    slot.parent.insertBefore(host.element, slot.before);
    render(h(CommentMenu, { read: () => describeComment(root) }), host.root);
  }
}

// --- PR list panels ------------------------------------------------------------------------

let pullsHost: Host | undefined;

function mountPullsPanels(): void {
  if (pullsHost?.element.isConnected) return;
  const anchor = findPullsAnchor();
  if (!anchor) return;
  if (!pullsHost) {
    pullsHost = makeHost(PULLS_ID);
    pullsHost.element.style.display = "block";
    render(h(PullsPanels, null), pullsHost.root);
  }
  pullsHost.element.dataset.position = anchor.position;
  // Re-inserting the same host keeps the Preact tree and its state (no refetch, no flicker).
  if (anchor.position === "before") anchor.node.insertAdjacentElement("beforebegin", pullsHost.element);
  else anchor.node.insertAdjacentElement("afterbegin", pullsHost.element);
}

function unmountPullsPanels(): void {
  if (!pullsHost) return;
  render(null, pullsHost.root);
  pullsHost.element.remove();
  pullsHost = undefined;
}

async function activatePulls(repo: RepoKey): Promise<void> {
  const run = ++pullsActivation;
  const viewer = readViewer();
  if (!viewer) return; // logged out: the panels need "@me"
  const enabled = await sendRequest({ type: "settings.get" })
    .then(({ settings }) => settings.pullsPanelsEnabled !== false)
    .catch(() => true);
  if (!enabled || run !== pullsActivation) return;
  currentPulls = repo;
  pulls.activate(repo, viewer);
  mountAll();
  observe();
}

// --- lifecycle --------------------------------------------------------------------------

function mountAll(): void {
  if (currentPr) {
    ensureStack(currentPr);
    mountOverlay();
    mountHeader();
    mountAgentBox();
    mountCommentMenus();
  } else if (currentPulls) {
    mountOverlay();
    mountPullsPanels();
  }
}

function observe(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => scheduleMount());
  observer.observe(document.body, { childList: true, subtree: true });
}

function scheduleMount(): void {
  if (mountScheduled) return;
  mountScheduled = true;
  window.setTimeout(() => {
    mountScheduled = false;
    mountAll();
  }, 250);
}

function isCurrent(location: PrLocation): boolean {
  return (
    !!currentPr &&
    currentPr.owner === location.owner &&
    currentPr.repo === location.repo &&
    currentPr.number === location.number
  );
}

function readContext(location: PrLocation): PrContext {
  const context = readPrContext(location);
  if (currentStack) context.stack = currentStack;
  return context;
}

/**
 * Find the PR's stack. A native GitHub stack comes from the page's embedded data, or from a fetch
 * of the PR page once GitHub's stack badge shows (the data is stale after a soft navigation).
 * PRs chained by branches are looked up alongside; a native stack wins over them.
 */
function ensureStack(location: PrLocation): void {
  if (stackPhase === "done") return;
  if (stackPhase === "page") {
    const fromPage = stackFromPage(location);
    if (fromPage) {
      stackPhase = "done";
      applyStack(location, fromPage);
      return;
    }
    const context = store.pr.value;
    if (!/merged|closed/i.test(context?.state ?? "")) {
      void branchStack({ ...location, title: context?.title ?? "" }).then((stack) => {
        if (stack) applyStack(location, stack);
      });
    }
    if (fromPage === null) {
      stackPhase = "done";
      return;
    }
    stackPhase = "badge";
  }
  // Checked again on every DOM change until GitHub renders the badge; PRs without one cost no request.
  if (!hasStackBadge()) return;
  stackPhase = "done";
  void fetchStack(location).then((stack) => {
    if (stack) applyStack(location, stack);
  });
}

function applyStack(location: PrLocation, stack: PrStack): void {
  const context = store.pr.value;
  if (!isCurrent(location) || !context) return;
  if (stack.source === "branches" && currentStack?.source === "native") return;
  currentStack = stack;
  // The current PR's title is read from the page; keep it in sync with the context.
  const pulls = stack.pulls.map((pull) =>
    pull.number === context.number && context.title ? { ...pull, title: context.title } : pull,
  );
  store.pr.value = { ...context, stack: { ...stack, pulls } };
}

function activate(location: PrLocation): void {
  currentPr = location;
  currentStack = undefined;
  stackPhase = "page";
  store.setPr(readContext(location));
  mountAll();
  observe();
  // GitHub fills in header details lazily; re-read the context once more.
  if (rereadTimer) window.clearTimeout(rereadTimer);
  rereadTimer = window.setTimeout(() => {
    if (isCurrent(location)) {
      const fresh = readContext(location);
      const previous = store.pr.value;
      if (JSON.stringify(fresh) !== JSON.stringify(previous)) store.pr.value = fresh;
    }
  }, 1500);
}

function deactivate(): void {
  currentPr = undefined;
  currentStack = undefined;
  stackPhase = "page";
  currentPulls = undefined;
  pullsActivation += 1;
  pulls.deactivate();
  unmountPullsPanels();
  observer?.disconnect();
  observer = undefined;
  store.setPr(undefined);
  store.closeComposer();
  store.dismissToast();
  if (header) {
    render(null, header.root);
    header.element.remove();
    header = undefined;
  }
  if (agentBox) {
    render(null, agentBox.root);
    agentBox.element.remove();
    agentBox = undefined;
  }
  for (const node of document.querySelectorAll(`.${COMMENT_CLASS}`)) node.remove();
  unmountOverlay();
}

// --- keyboard shortcut ----------------------------------------------------------------
// The browser normally delivers the extension command (background → "panel.toggle"). Some Chromium
// browsers do not, so the page also listens for the same key combination. If both fire for one
// key press, the second toggle within a short window is ignored.

let lastToggle = 0;

function togglePanel(): void {
  const now = Date.now();
  if (now - lastToggle < 400) return;
  lastToggle = now;
  if (store.composerOpen.value) store.closeComposer();
  else store.openComposer();
}

document.addEventListener(
  "keydown",
  (event) => {
    if (!currentPr || event.repeat) return;
    if (!matchesShortcut(event, parseShortcut(store.shortcut.value))) return;
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  },
  true,
);

watchLocation((page) => {
  if (page?.kind === "pulls") {
    deactivate();
    void activatePulls(page.repo);
    return;
  }
  const location = page?.pr;
  if (!location) {
    deactivate();
    return;
  }
  if (isCurrent(location)) {
    currentPr = location;
    scheduleMount();
    return;
  }
  deactivate();
  activate(location);
});

chrome.runtime.onMessage.addListener((message: ExtensionEvent) => {
  if (currentPulls) {
    if (message.type === "sessions.updated") {
      pulls.onSessionsChanged();
      if (store.pr.value) store.applySessionsEvent(message.sessions);
    }
    if (message.type === "connections.updated") {
      pulls.onConnectionsChanged();
      if (store.status.value === "error" && store.pr.value) void store.load(true);
    }
    return;
  }
  if (!currentPr) return;
  switch (message.type) {
    case "panel.toggle":
      togglePanel();
      break;
    case "panel.openWithSelection":
      store.openComposer({
        intentId: "builtin:reply-comment",
        comment: commentFromSelection(message.selection),
      });
      break;
    case "sessions.updated":
      store.applySessionsEvent(message.sessions);
      break;
    case "connections.updated":
      if (store.status.value === "error") void store.load(true);
      break;
  }
});
