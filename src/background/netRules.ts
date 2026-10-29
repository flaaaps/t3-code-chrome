import type { ServerConnection } from "@shared/models";

/**
 * T3's MCP endpoint rejects requests that carry an `Origin` header it does not know, and
 * Chrome always adds `Origin: chrome-extension://…` to the extension's own POST requests.
 * A declarativeNetRequest session rule strips that header for requests from this extension
 * to each configured T3 server only.
 */
export async function syncOriginRules(connections: ServerConnection[]): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr) return;
  const existing = await dnr.getSessionRules();
  const addRules: chrome.declarativeNetRequest.Rule[] = connections.map((connection, index) => ({
    id: 1000 + index,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "remove" }],
    },
    condition: {
      urlFilter: `${connection.origin}/`,
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest"],
    },
  }));
  await dnr.updateSessionRules({ removeRuleIds: existing.map((rule) => rule.id), addRules });
}
