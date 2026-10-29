import type { ExtensionEvent } from "@shared/client";
import type { PrLocation } from "@shared/prKey";
import { matchesShortcut, parseShortcut } from "@shared/shortcut";
import { h, render } from "preact";
import {
  findAgentBoxAnchor,
  findCommentActionContainers,
  findCommentRoot,
  findHeaderActions,
  findTitleRow,
  isIssueBody,
} from "./github/mountPoints";
import { commentFromSelection, describeComment, readPrContext } from "./github/prContext";
import { watchPrLocation } from "./github/prDetector";
import { AgentBox } from "./ui/AgentBox";
import { CommentMenu } from "./ui/CommentMenu";
import { Composer } from "./ui/Composer";
import { HeaderAction } from "./ui/HeaderAction";
import * as store from "./ui/store";
import { PANEL_STYLES } from "./ui/styles";
import { Toast } from "./ui/Toast";

const OVERLAY_ID = "t3-code-chrome-host";
const HEADER_ID = "t3-code-chrome-trigger";
const AGENTBOX_ID = "t3-code-chrome-agentbox";
const COMMENT_CLASS = "t3-code-chrome-comment";

let currentPr: PrLocation | undefined;
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
    header.element.style.marginLeft = "8px";
    actions.appendChild(header.element);
  } else {
    // Logged-out or unexpected layout: a right-aligned row under the PR header instead of a floating button.
    const anchor = findAgentBoxAnchor();
    header.element.style.display = "flex";
    header.element.style.justifyContent = "flex-end";
    header.element.style.margin = "8px 0";
    if (anchor?.position === "after") anchor.node.insertAdjacentElement("afterend", header.element);
    else if (anchor) anchor.node.insertAdjacentElement("beforebegin", header.element);
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
  if (anchor.position === "after") anchor.node.insertAdjacentElement("afterend", agentBox.element);
  else anchor.node.insertAdjacentElement("beforebegin", agentBox.element);
  render(h(AgentBox, null), agentBox.root);
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
    container.insertBefore(host.element, container.firstChild);
    render(h(CommentMenu, { read: () => describeComment(root) }), host.root);
  }
}

// --- lifecycle --------------------------------------------------------------------------

function mountAll(): void {
  if (!currentPr) return;
  mountOverlay();
  mountHeader();
  mountAgentBox();
  mountCommentMenus();
}

function scheduleMount(): void {
  if (mountScheduled) return;
  mountScheduled = true;
  window.setTimeout(() => {
    mountScheduled = false;
    mountAll();
  }, 250);
}

function activate(location: PrLocation): void {
  currentPr = location;
  store.setPr(readPrContext(location));
  mountAll();
  observer?.disconnect();
  observer = new MutationObserver(() => scheduleMount());
  observer.observe(document.body, { childList: true, subtree: true });
  // GitHub fills in header details lazily; re-read the context once more.
  if (rereadTimer) window.clearTimeout(rereadTimer);
  rereadTimer = window.setTimeout(() => {
    if (currentPr && currentPr.number === location.number) {
      const fresh = readPrContext(location);
      const previous = store.pr.value;
      if (JSON.stringify(fresh) !== JSON.stringify(previous)) store.pr.value = fresh;
    }
  }, 1500);
}

function deactivate(): void {
  currentPr = undefined;
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

watchPrLocation((location) => {
  if (!location) {
    deactivate();
    return;
  }
  if (
    currentPr &&
    currentPr.owner === location.owner &&
    currentPr.repo === location.repo &&
    currentPr.number === location.number
  ) {
    currentPr = location;
    scheduleMount();
    return;
  }
  deactivate();
  activate(location);
});

chrome.runtime.onMessage.addListener((message: ExtensionEvent) => {
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
