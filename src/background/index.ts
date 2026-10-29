import type { ExtensionEvent } from "@shared/messages";
import { ACTIVE_THREAD_STATUSES } from "@shared/models";
import { parsePrUrl } from "@shared/prKey";
import { Catalog } from "./catalog";
import { ConnectionManager } from "./connections";
import { githubTabPatterns, grantedEnterpriseHosts, syncEnterpriseHosts } from "./githubHosts";
import { syncOriginRules } from "./netRules";
import { installRouter } from "./router";
import { SessionTracker } from "./sessions";

const connections = new ConnectionManager();
const catalog = new Catalog(connections);
const sessions = new SessionTracker(catalog);

installRouter({ connections, catalog, sessions });

async function broadcast(event: ExtensionEvent): Promise<void> {
  const tabs = await chrome.tabs.query({ url: await githubTabPatterns() });
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, event).catch(() => undefined),
    ),
  );
  chrome.runtime.sendMessage(event).catch(() => undefined);
}

sessions.onChange((all) => {
  void broadcast({ type: "sessions.updated", sessions: all });
  void updateBadge();
});

connections.onChange(() => {
  void connections.linkState().then((link) => broadcast({ type: "connections.updated", link }));
  void connections
    .list()
    .then(syncOriginRules)
    .catch(() => undefined);
});

async function updateBadge(): Promise<void> {
  const inbox = await sessions.inbox();
  const active = inbox.filter((session) => ACTIVE_THREAD_STATUSES.has(session.status));
  const waiting = active.filter((session) => session.status === "waiting").length;
  await chrome.action.setBadgeText({
    text: waiting > 0 ? String(waiting) : active.length > 0 ? String(active.length) : "",
  });
  await chrome.action.setBadgeBackgroundColor({ color: waiting > 0 ? "#bf8700" : "#0969da" });
}

// Panels and popups keep a port open while visible: poll quickly and stay awake.
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("live:")) return;
  sessions.setLive(1);
  port.onDisconnect.addListener(() => sessions.setLive(-1));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void sessions.handleAlarm(alarm.name);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "t3-send-selection",
    title: "An T3 Code senden…",
    contexts: ["selection"],
    documentUrlPatterns: ["https://github.com/*/pull/*", "https://*.ghe.com/*/pull/*"],
  });
  void sessions.ensureAlarm();
  void syncEnterpriseHosts().catch(() => undefined);
});

// Enterprise Server hosts change in the options page; access to them can be revoked from the
// browser's extension settings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const before = (changes.settings.oldValue as { enterpriseHosts?: string[] } | undefined)?.enterpriseHosts;
  const after = (changes.settings.newValue as { enterpriseHosts?: string[] } | undefined)?.enterpriseHosts;
  if (JSON.stringify(before ?? []) !== JSON.stringify(after ?? [])) {
    void syncEnterpriseHosts().catch(() => undefined);
  }
});
chrome.permissions.onAdded.addListener(() => void syncEnterpriseHosts().catch(() => undefined));
chrome.permissions.onRemoved.addListener(() => void syncEnterpriseHosts().catch(() => undefined));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "t3-send-selection" || tab?.id === undefined) return;
  const event: ExtensionEvent = {
    type: "panel.openWithSelection",
    selection: (info.selectionText ?? "").trim(),
  };
  chrome.tabs.sendMessage(tab.id, event).catch(() => undefined);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-panel") return;
  void (async () => {
    // Some Chromium browsers (seen in Dia) deliver the command without a usable tab; fall back to
    // the active tab of the focused window.
    let target = tab?.id !== undefined && tab.url ? tab : undefined;
    if (!target) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      target = active;
    }
    console.info("[t3] command", command, { tabFromEvent: tab?.id, target: target?.id, url: target?.url });
    if (target?.id === undefined || !target.url || !parsePrUrl(target.url, await grantedEnterpriseHosts())) {
      return;
    }
    const event: ExtensionEvent = { type: "panel.toggle", source: "command" };
    await chrome.tabs.sendMessage(target.id, event).catch(() => undefined);
  })();
});

chrome.notifications?.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("job:")) return;
  void (async () => {
    const session = (await sessions.inbox()).find((s) => `job:${s.jobId}` === notificationId);
    if (!session) return;
    const url = `https://${session.pr.host}/${session.pr.owner}/${session.pr.repo}/pull/${session.pr.number}`;
    const [existing] = await chrome.tabs.query({ url: `${url}*` });
    if (existing?.id !== undefined) await chrome.tabs.update(existing.id, { active: true });
    else await chrome.tabs.create({ url });
    chrome.notifications.clear(notificationId);
  })();
});

void (async () => {
  await syncEnterpriseHosts().catch(() => undefined);
  await syncOriginRules(await connections.list()).catch(() => undefined);
  for (const connection of await connections.list()) {
    await connections.probe(connection.id).catch(() => undefined);
  }
  await updateBadge();
  const inbox = await sessions.inbox();
  if (inbox.some((session) => ACTIVE_THREAD_STATUSES.has(session.status) || session.status === "idle")) {
    await sessions.ensureAlarm();
  }
})();
