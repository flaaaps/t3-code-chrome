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

/** Parse a GitHub URL (or pathname) into a PR key. Returns undefined for non-PR pages. */
export function parsePrUrl(input: string | URL): PrLocation | undefined {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input, "https://github.com") : input;
  } catch {
    return undefined;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
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
  return { host: "github.com", owner, repo, number, tab };
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
