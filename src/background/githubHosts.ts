import { githubMatchPatterns, isGitHubHost } from "@shared/prKey";
import { loadSettings } from "./storage";

const SCRIPT_ID = "t3-github-enterprise";
const MENU_ID = "t3-send-selection";

/** Enterprise Server hosts the user added and still granted access to. */
export async function grantedEnterpriseHosts(): Promise<string[]> {
  const { enterpriseHosts } = await loadSettings();
  const custom = enterpriseHosts.filter((host) => !isGitHubHost(host));
  const granted = await Promise.all(
    custom.map((host) => chrome.permissions.contains({ origins: [`https://${host}/*`] })),
  );
  return custom.filter((_, index) => granted[index]);
}

export async function githubTabPatterns(): Promise<string[]> {
  return githubMatchPatterns(await grantedEnterpriseHosts());
}

/**
 * Inject the content script into the user's GitHub Enterprise Server hosts and keep the context
 * menu in step. github.com and `*.ghe.com` come from the manifest.
 */
export async function syncEnterpriseHosts(): Promise<void> {
  const hosts = await grantedEnterpriseHosts();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (hosts.length > 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: hosts.map((host) => `https://${host}/*`),
        js: ["content-standalone.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  }
  await chrome.contextMenus
    .update(MENU_ID, {
      documentUrlPatterns: githubMatchPatterns(hosts).map((p) => p.replace(/\*$/, "*/pull/*")),
    })
    .catch(() => undefined);
}
