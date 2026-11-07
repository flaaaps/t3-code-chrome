/**
 * The PR list page (`/<owner>/<repo>/pulls`): data model, parsing of the JSON GitHub embeds in the
 * server-rendered page, and the split into panels. No DOM access, so it runs in tests and workers.
 */
import { suggestIntent } from "./intent";
import { isActiveStatus, type PrContext, type PromptTemplate, type Session } from "./models";
import { type PrKey, prKeyToString, prUrl, type RepoKey } from "./prKey";

export type PrListRole = "author" | "assignee" | "review-requested";
export type PanelId = "review" | "mine";

export interface PrListLabel {
  name: string;
  color?: string;
}

export interface PrListItem extends PrKey {
  url: string;
  title: string;
  author?: string;
  isDraft: boolean;
  labels: PrListLabel[];
  createdAt?: string;
  updatedAt?: string;
  commentCount?: number;
  /** Place in a native GitHub stack (position counts from the bottom, 1-based). */
  stack?: { position: number; size: number };
  /** Why the PR is in a panel; filled by `assignPanels`. */
  roles: PrListRole[];
}

export interface PullsPageData {
  results: PrListItem[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

export interface PanelAssignment {
  /** Review requested from the viewer (shown first). */
  review: PrListItem[];
  /** Authored by or assigned to the viewer. */
  mine: PrListItem[];
  /** Total hits per panel on GitHub, including those beyond the first page. */
  totals: Record<PanelId, number>;
}

/** Search queries behind the panels. `@me` resolves to the signed-in user on GitHub and GHES. */
export const PANEL_QUERIES: Record<PrListRole, string> = {
  author: "is:pr state:open author:@me sort:updated-desc",
  assignee: "is:pr state:open assignee:@me sort:updated-desc",
  "review-requested": "is:pr state:open review-requested:@me sort:updated-desc",
};

/** The query to show a panel's full list on GitHub. */
export function panelQuery(panel: PanelId): string {
  return panel === "review" ? PANEL_QUERIES["review-requested"] : PANEL_QUERIES.author;
}

// --- parsing ---------------------------------------------------------------------------

const EMBEDDED = /<script\b[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/g;

/** Every JSON payload a server-rendered React page embeds (`react-app.embeddedData`). */
export function extractEmbeddedData(html: string): unknown[] {
  const result: unknown[] = [];
  for (const match of html.matchAll(EMBEDDED)) {
    const text = match[1]?.trim();
    if (!text) continue;
    try {
      result.push(JSON.parse(text));
    } catch {
      // ignore broken payloads; the caller reports "nothing found"
    }
  }
  return result;
}

/** Depth-first search for the first object that satisfies `test`; bounded to stay cheap. */
function findObject(value: unknown, test: (node: Record<string, unknown>) => boolean, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findObject(entry, test, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (test(record)) return record;
  for (const entry of Object.values(record)) {
    const found = findObject(entry, test, depth + 1);
    if (found) return found;
  }
  return undefined;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function parseListEntry(entry: unknown, repo: RepoKey): PrListItem | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const raw = entry as Record<string, unknown>;
  const number = num(raw.number);
  const title = str(raw.title);
  if (!number || !title) return undefined;
  const state = `${str(raw.state) ?? ""} ${str(raw.displayState) ?? ""}`.toUpperCase();
  if (/CLOSED|MERGED/.test(state) && !/OPEN/.test(state)) return undefined;
  const [owner, name] = (str(raw.repoNameWithOwner) ?? `${repo.owner}/${repo.repo}`).split("/");
  const key: PrKey = { host: repo.host, owner: owner ?? repo.owner, repo: name ?? repo.repo, number };
  const author = raw.author as Record<string, unknown> | undefined;
  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .map((label) => {
          const l = label as Record<string, unknown>;
          const labelName = str(l?.name);
          if (!labelName) return undefined;
          const color = str(l.color);
          return color && /^[0-9a-f]{6}$/i.test(color) ? { name: labelName, color } : { name: labelName };
        })
        .filter((label): label is PrListLabel => label !== undefined)
    : [];
  const item: PrListItem = {
    ...key,
    url: prUrl(key),
    title,
    isDraft: raw.isDraft === true || /DRAFT/.test(state),
    labels,
    roles: [],
  };
  const login = str(author?.displayLogin) ?? str(author?.login);
  if (login) item.author = login;
  const createdAt = str(raw.createdAt);
  if (createdAt) item.createdAt = createdAt;
  const stackSize = num(raw.stackSize);
  const stackPosition = num(raw.stackPosition);
  if (stackSize && stackSize > 1 && stackPosition) item.stack = { position: stackPosition, size: stackSize };
  const updatedAt = str(raw.updatedAt);
  if (updatedAt) item.updatedAt = updatedAt;
  const commentCount = num(raw.commentCount);
  if (commentCount !== undefined) item.commentCount = commentCount;
  return item;
}

/**
 * Read the PR list from a server-rendered `/pulls` page. Returns undefined when the page carries no
 * list payload (classic GitHub Enterprise markup, error pages); an empty result list is valid.
 */
export function parsePullsEmbedded(html: string, repo: RepoKey): PullsPageData | undefined {
  for (const payload of extractEmbeddedData(html)) {
    // GitHub omits `results` (and `totalCount`) when a search has no hits.
    const named = (payload as { payload?: Record<string, unknown> } | null)?.payload
      ?.repoPullsDashboardContentRoute;
    const route = (
      named && typeof named === "object"
        ? named
        : findObject(payload, (node) => Array.isArray(node.results) && "currentPage" in node)
    ) as Record<string, unknown> | undefined;
    if (!route) continue;
    const results = (Array.isArray(route.results) ? (route.results as unknown[]) : [])
      .map((entry) => parseListEntry(entry, repo))
      .filter((item): item is PrListItem => item !== undefined);
    return {
      results,
      currentPage: num(route.currentPage) ?? 1,
      totalPages: num(route.totalPages) ?? 1,
      totalCount: num(route.totalCount) ?? num(route.openCount) ?? results.length,
    };
  }
  return undefined;
}

export interface PrPageFacts {
  headBranch?: string;
  /** Owner of the repository the head branch lives in (differs from the PR's owner for forks). */
  headOwner?: string;
  baseBranch?: string;
  author?: string;
  title?: string;
}

/** Branches and author from a server-rendered PR page (`pullRequestsLayoutRoute.pullRequest`). */
export function parsePrPageEmbedded(html: string, number: number): PrPageFacts | undefined {
  for (const payload of extractEmbeddedData(html)) {
    const pr = findObject(payload, (node) => typeof node.headBranch === "string" && node.number === number) as
      | Record<string, unknown>
      | undefined;
    if (!pr) continue;
    const facts: PrPageFacts = {};
    const head = str(pr.headBranch);
    if (head) facts.headBranch = head;
    const headOwner = str(pr.headRepositoryOwnerLogin);
    if (headOwner) facts.headOwner = headOwner;
    const base = str(pr.baseBranch);
    if (base) facts.baseBranch = base;
    const title = str(pr.title);
    if (title) facts.title = title;
    const author = pr.author as Record<string, unknown> | undefined;
    const login = str(author?.login) ?? str(author?.displayLogin);
    if (login) facts.author = login;
    return facts;
  }
  return undefined;
}

const decodeEntities = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

function refFromSpan(html: string, kind: "base" | "head"): { owner?: string; branch: string } | undefined {
  const pattern = new RegExp(
    `<span[^>]*\\bid="${kind}-ref-\\d+"[^>]*>\\s*(?:<span class="user">([^<]*)</span>)?([^<]*)</span>`,
  );
  const match = pattern.exec(html);
  if (!match) return undefined;
  const owner = match[1]?.trim();
  const text = decodeEntities(match[2] ?? "").replace(/\s+/g, "");
  const branch = text.startsWith(":")
    ? text.slice(1)
    : text.includes(":")
      ? text.slice(text.indexOf(":") + 1)
      : text;
  if (!branch) return undefined;
  return owner ? { owner, branch } : { branch };
}

/**
 * Branches from a PR hovercard (`/<owner>/<repo>/pull/<n>/hovercard`, ~5 KB): the base and head
 * refs render as `<span id="base-ref-…"><span class="user">owner</span>:branch</span>`.
 */
export function parseHovercardRefs(html: string): PrPageFacts | undefined {
  const base = refFromSpan(html, "base");
  const head = refFromSpan(html, "head");
  if (!base && !head) return undefined;
  const facts: PrPageFacts = {};
  if (base) facts.baseBranch = base.branch;
  if (head) facts.headBranch = head.branch;
  if (head?.owner) facts.headOwner = head.owner;
  return facts;
}

// --- panels ------------------------------------------------------------------------------

/**
 * Split the three query results into panels. Authored and assigned PRs share "mine" (one row per
 * PR, roles merged); review requests go to "review" unless the PR is already in "mine".
 */
export function assignPanels(results: Record<PrListRole, PullsPageData>): PanelAssignment {
  const mine = new Map<string, PrListItem>();
  for (const role of ["author", "assignee"] as const) {
    for (const item of results[role].results) {
      const key = prKeyToString(item);
      const existing = mine.get(key);
      if (existing) {
        if (!existing.roles.includes(role)) existing.roles.push(role);
      } else {
        mine.set(key, { ...item, roles: [role] });
      }
    }
  }
  const review: PrListItem[] = [];
  for (const item of results["review-requested"].results) {
    const existing = mine.get(prKeyToString(item));
    if (existing) {
      if (!existing.roles.includes("review-requested")) existing.roles.push("review-requested");
      continue;
    }
    review.push({ ...item, roles: ["review-requested"] });
  }
  const mineList = [...mine.values()];
  return {
    review,
    mine: mineList,
    totals: {
      review: Math.max(results["review-requested"].totalCount, review.length),
      // Authored and assigned overlap; the larger count is the honest lower bound.
      mine: Math.max(results.author.totalCount, results.assignee.totalCount, mineList.length),
    },
  };
}

/** A row in a panel: a single PR, or the bottom of a stack with the PRs built on top of it. */
export interface PanelEntry {
  root: PrListItem;
  /** PRs stacked on the root, parent before child; `parent` is the PR they merge into. */
  stacked: Array<{ item: PrListItem; depth: number; parent: number }>;
}

/**
 * Group PRs that build on each other. B is stacked on A when B merges into A's head branch and that
 * branch lives in the same repository (a fork's branch cannot be a base). Branches come from
 * `branches` (keyed by `prKeyToString`); PRs without known branches stay single rows.
 */
export function groupStacks(items: PrListItem[], branches: Record<string, PrPageFacts>): PanelEntry[] {
  const byHead = new Map<string, PrListItem>();
  for (const item of items) {
    const facts = branches[prKeyToString(item)];
    if (!facts?.headBranch) continue;
    if (facts.headOwner && facts.headOwner.toLowerCase() !== item.owner.toLowerCase()) continue;
    byHead.set(`${item.owner}/${item.repo}:${facts.headBranch}`.toLowerCase(), item);
  }
  const parentOf = new Map<string, PrListItem>();
  const children = new Map<string, PrListItem[]>();
  for (const item of items) {
    const base = branches[prKeyToString(item)]?.baseBranch;
    if (!base) continue;
    const parent = byHead.get(`${item.owner}/${item.repo}:${base}`.toLowerCase());
    if (!parent || parent === item) continue;
    parentOf.set(prKeyToString(item), parent);
    const list = children.get(prKeyToString(parent)) ?? [];
    list.push(item);
    children.set(prKeyToString(parent), list);
  }
  // Break cycles (A → B → A): a PR whose ancestor chain returns to itself becomes a root.
  const isRoot = (item: PrListItem) => {
    const seen = new Set<string>([prKeyToString(item)]);
    let current = parentOf.get(prKeyToString(item));
    while (current) {
      const key = prKeyToString(current);
      if (seen.has(key)) return true;
      seen.add(key);
      current = parentOf.get(key);
    }
    return !parentOf.has(prKeyToString(item));
  };
  const placed = new Set<string>();
  const entries: PanelEntry[] = [];
  for (const item of items) {
    if (!isRoot(item) || placed.has(prKeyToString(item))) continue;
    placed.add(prKeyToString(item));
    const entry: PanelEntry = { root: item, stacked: [] };
    const walk = (parent: PrListItem, depth: number) => {
      const kids = [...(children.get(prKeyToString(parent)) ?? [])].sort((a, b) => a.number - b.number);
      for (const kid of kids) {
        const key = prKeyToString(kid);
        if (placed.has(key)) continue;
        placed.add(key);
        entry.stacked.push({ item: kid, depth, parent: parent.number });
        walk(kid, depth + 1);
      }
    };
    walk(item, 1);
    entries.push(entry);
  }
  // Anything left over (only possible with inconsistent data) stays visible as a single row.
  for (const item of items) {
    if (!placed.has(prKeyToString(item))) entries.push({ root: item, stacked: [] });
  }
  return entries;
}

export function entryItems(entry: PanelEntry): PrListItem[] {
  return [entry.root, ...entry.stacked.map((s) => s.item)];
}

/**
 * Rank inside a panel: an agent waiting for you, then running sessions, then newest activity. A
 * stack ranks by its most urgent and most recently updated PR.
 */
export function sortPanelEntries(
  entries: PanelEntry[],
  sessionsByPr: Record<string, Session[]>,
): PanelEntry[] {
  const rankOf = (item: PrListItem) => {
    const sessions = sessionsByPr[prKeyToString(item)] ?? [];
    if (sessions.some((s) => s.status === "waiting")) return 0;
    if (sessions.some((s) => isActiveStatus(s.status))) return 1;
    return 2;
  };
  const rank = (entry: PanelEntry) => Math.min(...entryItems(entry).map(rankOf));
  const updated = (entry: PanelEntry) =>
    entryItems(entry)
      .map((item) => item.updatedAt ?? "")
      .sort()
      .at(-1) ?? "";
  return [...entries].sort((a, b) => {
    const order = rank(a) - rank(b);
    if (order !== 0) return order;
    return updated(b).localeCompare(updated(a));
  });
}

/** What the list knows about a PR, as the context the prompt templates render. */
export function prListItemToContext(
  item: PrListItem,
  viewer: string | undefined,
  facts: PrPageFacts = {},
): PrContext {
  const context: PrContext = {
    host: item.host,
    owner: item.owner,
    repo: item.repo,
    number: item.number,
    url: item.url,
    title: facts.title ?? item.title,
    isDraft: item.isDraft,
    state: item.isDraft ? "draft" : "open",
    checksState: "unknown",
  };
  const author = facts.author ?? item.author;
  if (author) context.author = author;
  if (viewer) context.viewer = viewer;
  if (facts.headBranch) context.headBranch = facts.headBranch;
  if (facts.baseBranch) context.baseBranch = facts.baseBranch;
  return context;
}

export type PrimaryAction =
  | { kind: "open"; session: Session; label: string }
  | { kind: "intent"; template: PromptTemplate; label: string };

/**
 * The row's main button. A running or waiting session wins ("Session öffnen"/"Antworten"); otherwise
 * the suggested action, where your own PRs default to a summary and review requests to a review.
 */
export function primaryActionFor(
  item: PrListItem,
  panel: PanelId,
  sessions: Session[],
  templates: PromptTemplate[],
  viewer: string | undefined,
): PrimaryAction {
  const active = sessions.filter((s) => isActiveStatus(s.status));
  const waiting = active.find((s) => s.status === "waiting");
  if (waiting) return { kind: "open", session: waiting, label: "Antworten" };
  const running = active[0];
  if (running) return { kind: "open", session: running, label: "Session öffnen" };
  const template = suggestIntent(
    prListItemToContext(item, viewer),
    templates,
    panel === "mine" ? "builtin:summarize" : "builtin:review",
  );
  return { kind: "intent", template, label: template.actionLabel ?? template.name };
}
