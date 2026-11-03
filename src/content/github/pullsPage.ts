/**
 * Reading GitHub's PR list for the panels: fetch `/pulls?q=…` pages with the user's own session
 * (no GitHub token), parse the embedded JSON, fall back to the classic list markup on older GitHub
 * Enterprise Server. Also finds where the panels mount and reads a PR's branch on demand.
 */

import { type PrKey, prKeyToString, pullsPath, type RepoKey } from "@shared/prKey";
import {
  assignPanels,
  PANEL_QUERIES,
  type PanelAssignment,
  type PrListItem,
  type PrListRole,
  type PrPageFacts,
  type PullsPageData,
  parseHovercardRefs,
  parsePrPageEmbedded,
  parsePullsEmbedded,
} from "@shared/pulls";

const LIST_TTL_MS = 60_000;
const FACTS_TTL_MS = 5 * 60_000;
const BACKOFF_MS = 5 * 60_000;

const SELECTORS = {
  viewer: "meta[name='user-login']",
  reactApp: "#repo-content-turbo-frame react-app[app-name='repo'], react-app[app-name='repo']",
  pjax: "#repo-content-pjax-container, .repository-content",
  // Classic list (GitHub Enterprise Server before the React list).
  classicRow: ".js-issue-row",
  classicTitle: "a.js-navigation-open, a[data-hovercard-type='pull_request']",
  classicAuthor: ".opened-by a",
  classicLabel: ".IssueLabel",
  classicDraft: ".State--draft, [aria-label*='Draft' i]",
} as const;

export class PullsFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PullsFetchError";
  }
}

/** The signed-in user; undefined when logged out (the meta tag exists but is empty). */
export function readViewer(root: ParentNode = document): string | undefined {
  return root.querySelector<HTMLMetaElement>(SELECTORS.viewer)?.content.trim() || undefined;
}

/** Where the panels go: right before GitHub's React app, else at the top of the repo content. */
export function findPullsAnchor(): { node: Element; position: "before" | "prepend" } | undefined {
  const app = document.querySelector(SELECTORS.reactApp);
  if (app) return { node: app, position: "before" };
  const content = document.querySelector(SELECTORS.pjax) ?? document.querySelector("main");
  return content ? { node: content, position: "prepend" } : undefined;
}

// --- list fetches ----------------------------------------------------------------------

const listCache = new Map<string, { at: number; value: Promise<PullsPageData> }>();
let backoffUntil = 0;

async function fetchHtml(path: string, headers: Record<string, string> = {}): Promise<string> {
  if (Date.now() < backoffUntil) {
    throw new PullsFetchError(
      "GitHub bremst gerade Anfragen. Bitte in ein paar Minuten erneut versuchen.",
      429,
    );
  }
  const response = await fetch(`${window.location.origin}${path}`, {
    credentials: "same-origin",
    headers: { accept: "text/html", ...headers },
  });
  if (response.status === 429) {
    backoffUntil = Date.now() + BACKOFF_MS;
    throw new PullsFetchError(
      "GitHub bremst gerade Anfragen. Bitte in ein paar Minuten erneut versuchen.",
      429,
    );
  }
  if (!response.ok) throw new PullsFetchError(`GitHub antwortet mit ${response.status}.`, response.status);
  return response.text();
}

/** Parse a fetched `/pulls` page: embedded JSON first, classic markup second. */
export function parsePullsPage(html: string, repo: RepoKey): PullsPageData | undefined {
  const embedded = parsePullsEmbedded(html, repo);
  if (embedded) return embedded;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return parsePullsClassicDom(doc, repo);
}

/** Classic list rows (`.js-issue-row`). Unverified against a live GHES; kept deliberately loose. */
export function parsePullsClassicDom(root: ParentNode, repo: RepoKey): PullsPageData | undefined {
  const rows = [...root.querySelectorAll<HTMLElement>(SELECTORS.classicRow)];
  if (rows.length === 0) {
    // A classic page with no rows still has the "No results" blankslate inside the issues listing.
    if (root.querySelector("#js-issues-toolbar, .js-navigation-container")) {
      return { results: [], currentPage: 1, totalPages: 1, totalCount: 0 };
    }
    return undefined;
  }
  const results: PrListItem[] = [];
  for (const row of rows) {
    const link = row.querySelector<HTMLAnchorElement>(SELECTORS.classicTitle);
    const number = Number.parseInt(
      row.id.match(/(\d+)$/)?.[1] ?? link?.getAttribute("href")?.match(/\/pull\/(\d+)/)?.[1] ?? "",
      10,
    );
    const title = link?.textContent?.replace(/\s+/g, " ").trim();
    if (!Number.isFinite(number) || number <= 0 || !title) continue;
    const key: PrKey = { ...repo, number };
    const item: PrListItem = {
      ...key,
      url: `https://${repo.host}/${repo.owner}/${repo.repo}/pull/${number}`,
      title,
      isDraft: !!row.querySelector(SELECTORS.classicDraft),
      labels: [...row.querySelectorAll<HTMLElement>(SELECTORS.classicLabel)]
        .map((label) => label.textContent?.trim() ?? "")
        .filter((name) => name.length > 0)
        .map((name) => ({ name })),
      roles: [],
    };
    const author = row.querySelector(SELECTORS.classicAuthor)?.textContent?.trim();
    if (author) item.author = author;
    const updated = row.querySelector("relative-time")?.getAttribute("datetime");
    if (updated) item.updatedAt = updated;
    results.push(item);
  }
  const lastPage = [...root.querySelectorAll(".pagination a, .pagination em")]
    .map((node) => Number.parseInt(node.textContent ?? "", 10))
    .filter(Number.isFinite);
  return {
    results,
    currentPage: 1,
    totalPages: lastPage.length > 0 ? Math.max(...lastPage) : 1,
    totalCount: results.length,
  };
}

function fetchQuery(repo: RepoKey, query: string, force: boolean): Promise<PullsPageData> {
  const key = `${repo.host}/${repo.owner}/${repo.repo}|${query}`.toLowerCase();
  const cached = listCache.get(key);
  if (!force && cached && Date.now() - cached.at < LIST_TTL_MS) return cached.value;
  const value = fetchHtml(pullsPath(repo, query)).then((html) => {
    const parsed = parsePullsPage(html, repo);
    if (!parsed) {
      console.warn("[t3] pulls: no list payload or classic rows in", pullsPath(repo, query));
      throw new PullsFetchError("Die GitHub-Liste konnte nicht gelesen werden.");
    }
    return parsed;
  });
  listCache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (listCache.get(key)?.value === value) listCache.delete(key);
  });
  return value;
}

/** Load both panels: three searches in parallel, split into "Review angefragt" and "Meine". */
export async function loadPanels(repo: RepoKey, force = false): Promise<PanelAssignment> {
  const roles: PrListRole[] = ["author", "assignee", "review-requested"];
  const pages = await Promise.all(roles.map((role) => fetchQuery(repo, PANEL_QUERIES[role], force)));
  const [author, assignee, review] = pages as [PullsPageData, PullsPageData, PullsPageData];
  return assignPanels({ author, assignee, "review-requested": review });
}

// --- PR facts (branch) -------------------------------------------------------------------

const factsCache = new Map<string, { at: number; value: Promise<PrPageFacts> }>();

function stripOwner(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.includes(":") ? text.slice(text.lastIndexOf(":") + 1).trim() : text;
}

async function factsFromPage(pr: PrKey): Promise<PrPageFacts> {
  const html = await fetchHtml(`/${pr.owner}/${pr.repo}/pull/${pr.number}`);
  const embedded = parsePrPageEmbedded(html, pr.number);
  if (embedded?.headBranch) return embedded;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const facts: PrPageFacts = { ...embedded };
  const head = stripOwner(doc.querySelector(".head-ref")?.textContent);
  const base = stripOwner(doc.querySelector(".base-ref")?.textContent);
  if (head) facts.headBranch = head;
  if (base) facts.baseBranch = base;
  return facts;
}

/**
 * Head and base branch of a PR (the list does not carry them). Reads the PR's hovercard (~5 KB)
 * and falls back to the full PR page. Errors resolve to `{}`: stacks then stay ungrouped and an
 * action starts in the project checkout instead of a worktree.
 */
export function loadPrFacts(pr: PrKey): Promise<PrPageFacts> {
  const key = prKeyToString(pr);
  const cached = factsCache.get(key);
  if (cached && Date.now() - cached.at < FACTS_TTL_MS) return cached.value;
  const value = fetchHtml(`/${pr.owner}/${pr.repo}/pull/${pr.number}/hovercard`, {
    "x-requested-with": "XMLHttpRequest",
  })
    .then((html) => parseHovercardRefs(html))
    .catch(() => undefined)
    .then((facts) => (facts?.headBranch && facts.baseBranch ? facts : factsFromPage(pr)))
    .catch((): PrPageFacts => {
      factsCache.delete(key);
      return {};
    });
  factsCache.set(key, { at: Date.now(), value });
  return value;
}

/** Branches of many PRs, at most `concurrency` requests at a time; keyed by `prKeyToString`. */
export async function loadBranches(prs: PrKey[], concurrency = 4): Promise<Record<string, PrPageFacts>> {
  const result: Record<string, PrPageFacts> = {};
  const queue = [...prs];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      result[prKeyToString(next)] = await loadPrFacts(next);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, prs.length) }, worker));
  return result;
}

/** Forget cached list pages (the "Aktualisieren" button). */
export function clearPullsCache(): void {
  listCache.clear();
}
