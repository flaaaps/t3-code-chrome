import type { ExtensionEvent } from "@shared/messages";
import { parsePrUrl } from "@shared/prKey";
import { Catalog } from "./catalog";
import { ConnectionManager } from "./connections";
import { JobTracker } from "./jobs";
import { syncOriginRules } from "./netRules";
import { installRouter } from "./router";

const connections = new ConnectionManager();
const catalog = new Catalog(connections);
const jobs = new JobTracker(catalog);

installRouter({ connections, catalog, jobs });

async function broadcast(event: ExtensionEvent): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "https://github.com/*" });
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, event).catch(() => undefined),
    ),
  );
  chrome.runtime.sendMessage(event).catch(() => undefined);
}

jobs.onChange((all) => {
  void broadcast({ type: "jobs.updated", jobs: all });
  void updateBadge();
});

connections.onChange(() => {
  void broadcast({ type: "connections.updated" });
  void connections
    .list()
    .then(syncOriginRules)
    .catch(() => undefined);
});

async function updateBadge(): Promise<void> {
  const active = (await jobs.list()).filter((job) =>
    ["preparing", "queued", "starting", "running", "waiting"].includes(job.status),
  );
  const waiting = active.filter((job) => job.status === "waiting").length;
  await chrome.action.setBadgeText({ text: active.length > 0 ? String(active.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: waiting > 0 ? "#d97706" : "#4f46e5" });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  void jobs.handleAlarm(alarm.name);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "t3-send-selection",
    title: "Mit T3 Code bearbeiten…",
    contexts: ["selection"],
    documentUrlPatterns: ["https://github.com/*/pull/*"],
  });
  void jobs.ensureAlarm();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "t3-send-selection" || tab?.id === undefined) return;
  const selection = (info.selectionText ?? "").trim();
  const event: ExtensionEvent = { type: "panel.openWithSelection", selection };
  chrome.tabs.sendMessage(tab.id, event).catch(() => undefined);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-panel" || tab?.id === undefined || !tab.url || !parsePrUrl(tab.url)) return;
  const event: ExtensionEvent = { type: "panel.toggle" };
  chrome.tabs.sendMessage(tab.id, event).catch(() => undefined);
});

chrome.notifications?.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("job:")) return;
  void (async () => {
    const job = (await jobs.list()).find((j) => `job:${j.id}` === notificationId);
    if (!job) return;
    const url = `https://${job.pr.host}/${job.pr.owner}/${job.pr.repo}/pull/${job.pr.number}`;
    const [existing] = await chrome.tabs.query({ url: `${url}*` });
    if (existing?.id !== undefined) await chrome.tabs.update(existing.id, { active: true });
    else await chrome.tabs.create({ url });
    chrome.notifications.clear(notificationId);
  })();
});

// Warm up health on start so the first panel open is fast.
void (async () => {
  await syncOriginRules(await connections.list()).catch(() => undefined);
  for (const connection of await connections.list()) {
    await connections.probe(connection.id).catch(() => undefined);
  }
  await updateBadge();
  const active = (await jobs.list()).some((job) =>
    ["preparing", "queued", "starting", "running", "waiting", "idle"].includes(job.status),
  );
  if (active) await jobs.ensureAlarm();
})();
