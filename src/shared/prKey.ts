export interface PrKey {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export type PrPageTab = "conversation" | "commits" | "checks" | "files" | "other";

export interface PrLocation extends PrKey {
  tab: PrPageTab;
}

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^/?#]+))?/;

/** GitHub Enterprise Cloud with data residency lives on `<tenant>.ghe.com`. */
const GHE_CLOUD = /^[a-z0-9-]+\.ghe\.com$/;

/**
 * Whether a hostname serves GitHub: github.com, any `*.ghe.com` tenant, or one of the GitHub
 * Enterprise Server hosts the user added in the options.
 */
export function isGitHubHost(hostname: string, enterpriseHosts: readonly string[] = []): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "github.com" ||
    host === "www.github.com" ||
    GHE_CLOUD.test(host) ||
    enterpriseHosts.some((entry) => entry.toLowerCase() === host)
  );
}

/**
 * Turn user input ("github.acme.corp", "https://github.acme.corp/org/repo") into a bare hostname.
 * Returns undefined for anything that is not a plausible host.
 */
export function normaliseEnterpriseHost(input: string): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  let hostname: string;
  try {
    hostname = new URL(text.includes("://") ? text : `https://${text}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!/^[a-z0-9.-]+$/.test(hostname) || !hostname.includes(".")) return undefined;
  if (hostname === "www.github.com") return "github.com";
  return hostname;
}

/** Match patterns for every page the content script runs on. */
export function githubMatchPatterns(enterpriseHosts: readonly string[] = []): string[] {
  return [
    "https://github.com/*",
    "https://*.ghe.com/*",
    ...enterpriseHosts.filter((host) => !isGitHubHost(host)).map((host) => `https://${host}/*`),
  ];
}

/**
 * Parse a GitHub URL (or pathname) into a PR key. Returns undefined for non-PR pages.
 * `hosts: "any"` skips the host check; the content script uses it because it only runs on pages
 * the extension already decided are GitHub.
 */
export function parsePrUrl(
  input: string | URL,
  hosts: readonly string[] | "any" = [],
): PrLocation | undefined {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input, "https://github.com") : input;
  } catch {
    return undefined;
  }
  if (hosts !== "any" && !isGitHubHost(url.hostname, hosts)) return undefined;
  const host = url.hostname.toLowerCase() === "www.github.com" ? "github.com" : url.hostname.toLowerCase();
  const match = PR_PATH.exec(url.pathname);
  if (!match) return undefined;
  const [, owner, repo, numberText, segment] = match;
  if (!owner || !repo || !numberText) return undefined;
  const number = Number.parseInt(numberText, 10);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  const tab: PrPageTab =
    segment === undefined
      ? "conversation"
      : segment === "commits" || segment === "checks" || segment === "files"
        ? segment
        : "other";
  return { host, owner, repo, number, tab };
}

export function prKeyEquals(a: PrKey | undefined, b: PrKey | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.host === b.host &&
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase() &&
    a.number === b.number
  );
}

export function prKeyToString(key: PrKey): string {
  return `${key.host}/${key.owner}/${key.repo}#${key.number}`;
}

export function prUrl(key: PrKey): string {
  return `https://${key.host}/${key.owner}/${key.repo}/pull/${key.number}`;
}

/** `github.com/owner/repo`, matching T3's `repositoryIdentity.canonicalKey`. */
export function repoCanonicalKey(key: Pick<PrKey, "host" | "owner" | "repo">): string {
  return `${key.host}/${key.owner}/${key.repo}`.toLowerCase();
}

/** Normalise a remote URL or canonical key to `host/owner/repo` in lower case. */
export function normaliseRepoIdentifier(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  let text = value.trim();
  if (text.length === 0) return undefined;
  const scp = /^(?:[\w.-]+@)?([\w.-]+):([^/].*)$/.exec(text);
  if (scp?.[1] && scp[2] && !text.includes("://")) {
    text = `${scp[1]}/${scp[2]}`;
  } else {
    try {
      const url = new URL(text.includes("://") ? text : `https://${text}`);
      text = `${url.hostname}${url.pathname}`;
    } catch {
      // keep as is
    }
  }
  text = text
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const parts = text.split("/");
  if (parts.length < 3) return undefined;
  return `${parts[0]}/${parts[1]}/${parts[2]}`.toLowerCase();
}
