import type { EnvironmentTarget } from "./catalog";
import type { ConnectionManager } from "./connections";

/**
 * Open a thread for the user. The desktop app registers the `t3code:` scheme and accepts
 * `t3code://threads/<environmentId>/<threadId>`; remote servers fall back to the web UI.
 */
export async function openThread(
  connections: ConnectionManager,
  target: EnvironmentTarget,
  threadId: string,
): Promise<"app" | "web"> {
  const connection = await connections.get(target.connectionId);
  const path = `/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(threadId)}`;
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(connection.origin);
  if (local) {
    try {
      const tab = await chrome.tabs.create({ url: `t3code://threads${path}`, active: false });
      setTimeout(() => {
        if (tab.id !== undefined) chrome.tabs.remove(tab.id).catch(() => undefined);
      }, 2000);
      return "app";
    } catch {
      // fall through to web
    }
  }
  await chrome.tabs.create({ url: `${connection.origin}${path}` });
  return "web";
}
