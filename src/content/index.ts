import type { ExtensionEvent } from "@shared/messages";
import type { Job, PrContext } from "@shared/models";
import type { PrLocation } from "@shared/prKey";
import { h, render } from "preact";
import { findCommentActionContainers, findCommentRoot, findHeaderActions } from "./github/mountPoints";
import { describeComment, readPrContext } from "./github/prContext";
import { watchPrLocation } from "./github/prDetector";
import { App, type AppController, triggerState } from "./ui/App";
import { PANEL_STYLES } from "./ui/styles";

const HOST_ID = "t3-code-chrome-host";
const TRIGGER_HOST_ID = "t3-code-chrome-trigger";
const COMMENT_BUTTON_CLASS = "t3-code-chrome-comment-btn";

let controller: AppController | undefined;
let panelHost: HTMLElement | undefined;
let triggerHost: HTMLElement | undefined;
let triggerButton: HTMLButtonElement | undefined;
let currentPr: PrLocation | undefined;
let mountObserver: MutationObserver | undefined;
let pendingSelection: string | undefined;

function ensurePanelHost(): HTMLElement {
  if (panelHost?.isConnected) return panelHost;
  panelHost = (document.getElementById(HOST_ID) as HTMLElement | null) ?? undefined;
  if (!panelHost) {
    panelHost = document.createElement("div");
    panelHost.id = HOST_ID;
    document.body.appendChild(panelHost);
    const shadow = panelHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_STYLES;
    shadow.appendChild(style);
    const root = document.createElement("div");
    root.id = "root";
    shadow.appendChild(root);
  }
  return panelHost;
}

function renderApp(pr: PrContext): void {
  const host = ensurePanelHost();
  const root = host.shadowRoot?.getElementById("root");
  if (!root) return;
  render(
    h(App, {
      pr,
      register: (next: AppController) => {
        controller = next;
        if (pendingSelection !== undefined) {
          const selection = pendingSelection;
          pendingSelection = undefined;
          next.openWithSelection(selection);
        }
      },
      onJobsChanged: updateTrigger,
    }),
    root,
  );
}

function unmountApp(): void {
  const root = panelHost?.shadowRoot?.getElementById("root");
  if (root) render(null, root);
  controller = undefined;
  triggerHost?.remove();
  triggerHost = undefined;
  triggerButton = undefined;
  for (const node of document.querySelectorAll(`.${COMMENT_BUTTON_CLASS}`)) node.remove();
}

function updateTrigger(jobs: Job[]): void {
  if (!triggerButton) return;
  const { count, state } = triggerState(jobs);
  const dot = triggerButton.querySelector(".dot");
  if (dot) dot.className = `dot ${state === "idle" ? "" : state}`;
  const badge = triggerButton.querySelector(".badge");
  if (badge) {
    badge.textContent = count > 0 ? String(count) : "";
    (badge as HTMLElement).style.display = count > 0 ? "" : "none";
  }
}

function mountTrigger(): void {
  if (triggerHost?.isConnected) return;
  const actions = findHeaderActions();
  triggerHost = document.createElement("span");
  triggerHost.id = TRIGGER_HOST_ID;
  triggerHost.style.display = "inline-flex";
  triggerHost.style.marginLeft = "8px";
  triggerHost.style.verticalAlign = "middle";
  const shadow = triggerHost.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_STYLES;
  shadow.appendChild(style);
  triggerButton = document.createElement("button");
  triggerButton.type = "button";
  triggerButton.className = "t3-trigger";
  triggerButton.title = "Mit T3 Code bearbeiten (Alt+Shift+T)";
  triggerButton.innerHTML = `<span class="dot"></span><span>T3 Code</span><span class="badge" style="display:none"></span>`;
  triggerButton.addEventListener("click", () => controller?.toggle());
  shadow.appendChild(triggerButton);
  if (actions) {
    actions.appendChild(triggerHost);
  } else {
    // Floating fallback when GitHub's header markup is not found.
    Object.assign(triggerHost.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147482000",
      marginLeft: "0",
    });
    document.body.appendChild(triggerHost);
  }
}

function mountCommentButtons(): void {
  for (const container of findCommentActionContainers()) {
    if (container.querySelector(`.${COMMENT_BUTTON_CLASS}`)) continue;
    const root = findCommentRoot(container);
    if (!root) continue;
    const host = document.createElement("span");
    host.className = COMMENT_BUTTON_CLASS;
    host.style.display = "inline-flex";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_STYLES;
    shadow.appendChild(style);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "t3-comment-btn";
    button.title = "Diesen Kommentar an T3 Code senden";
    button.textContent = "T3";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openWithSelection(describeComment(root));
    });
    shadow.appendChild(button);
    container.insertBefore(host, container.firstChild);
  }
}

function openWithSelection(selection: string): void {
  if (controller) controller.openWithSelection(selection);
  else pendingSelection = selection;
}

function observeMounts(): void {
  mountObserver?.disconnect();
  mountObserver = new MutationObserver(() => {
    if (!currentPr) return;
    scheduleMount();
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });
}

let mountScheduled = false;
function scheduleMount(): void {
  if (mountScheduled) return;
  mountScheduled = true;
  window.setTimeout(() => {
    mountScheduled = false;
    if (!currentPr) return;
    mountTrigger();
    mountCommentButtons();
  }, 250);
}

function activate(location: PrLocation): void {
  currentPr = location;
  const context = readPrContext(location);
  renderApp(context);
  mountTrigger();
  mountCommentButtons();
  observeMounts();
  // GitHub fills in header details lazily; re-read once more shortly after.
  window.setTimeout(() => {
    if (currentPr && currentPr.number === location.number) renderApp(readPrContext(location));
  }, 1200);
}

function deactivate(): void {
  currentPr = undefined;
  mountObserver?.disconnect();
  mountObserver = undefined;
  unmountApp();
}

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
  if (message.type === "panel.toggle") controller?.toggle();
  if (message.type === "panel.openWithSelection") openWithSelection(message.selection);
});
