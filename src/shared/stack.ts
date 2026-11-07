/**
 * PR stacks. Native GitHub stacks: a server-rendered PR page embeds the stack next to the PR
 * (`payload.pullRequestsLayoutRoute.{pullRequest, stack}`); `stack` is `null` for a PR outside a
 * stack. Stacks by branches: PRs whose base is another open PR's head (`discoverBranchStack`).
 * No DOM access, so it runs in tests and workers.
 */
import type { PrContext, PrStack, PrStackEntry } from "./models";
import { type PrKey, prUrl } from "./prKey";
import type { PrListItem, PrPageFacts } from "./pulls";

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

function findLayoutRoute(value: unknown, number: number, depth = 0): Record<string, unknown> | undefined {
  if (depth > 8 || value === null || typeof value !== "object") return undefined;
  if (!Array.isArray(value)) {
    const node = value as Record<string, unknown>;
    const pr = node.pullRequest as Record<string, unknown> | undefined;
    if ("stack" in node && pr && typeof pr === "object" && pr.number === number) return node;
  }
  for (const entry of Object.values(value)) {
    const found = findLayoutRoute(entry, number, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function entryState(value: unknown): PrStackEntry["state"] {
  const state = String(value ?? "").toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return "open";
}

/**
 * The stack of PR `number` from the page's embedded JSON payloads. `null`: the page says the PR is
 * not in a stack. `undefined`: no payload for this PR (e.g. stale data after a soft navigation).
 */
export function parsePrStack(payloads: unknown[], number: number): PrStack | null | undefined {
  for (const payload of payloads) {
    const route = findLayoutRoute(payload, number);
    if (!route) continue;
    const raw = route.stack as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.pulls)) return null;
    const pulls: PrStackEntry[] = [];
    // GitHub lists the stack top first; the model keeps it bottom first.
    for (const item of [...raw.pulls].reverse()) {
      const pull = item as Record<string, unknown>;
      const prNumber = typeof pull.number === "number" ? pull.number : Number.NaN;
      if (!Number.isInteger(prNumber) || prNumber <= 0) continue;
      const entry: PrStackEntry = {
        number: prNumber,
        title: str(pull.title) ?? `#${prNumber}`,
        state: entryState(pull.state),
      };
      const head = str(pull.headBranch);
      if (head) entry.headBranch = head;
      pulls.push(entry);
    }
    if (!pulls.some((pull) => pull.number === number)) return null;
    const stack: PrStack = { source: "native", pulls };
    const base = str(raw.baseBranch);
    if (base) stack.baseBranch = base;
    return stack;
  }
  return undefined;
}

export interface StackReviewEntry extends PrStackEntry {
  url: string;
  baseBranch?: string;
  current: boolean;
}

/**
 * The open PRs of the stack a review should cover, bottom first, each with the branch it merges
 * into. Undefined unless the PR itself is open and at least one other open PR shares its stack.
 */
export function stackReviewEntries(pr: PrContext): StackReviewEntry[] | undefined {
  const pulls = pr.stack?.pulls;
  if (!pulls) return undefined;
  const entries: StackReviewEntry[] = [];
  pulls.forEach((pull, index) => {
    if (pull.state !== "open") return;
    // A merged PR below has already landed in the stack's base.
    const below = pulls
      .slice(0, index)
      .reverse()
      .find((other) => other.state === "open");
    const base = pull.baseBranch ?? (below ? below.headBranch : pr.stack?.baseBranch);
    const entry: StackReviewEntry = {
      ...pull,
      url: prUrl({ host: pr.host, owner: pr.owner, repo: pr.repo, number: pull.number }),
      current: pull.number === pr.number,
    };
    if (base) entry.baseBranch = base;
    entries.push(entry);
  });
  if (entries.length < 2 || !entries.some((entry) => entry.current)) return undefined;
  return entries;
}

/** Head branch of the topmost open PR: a checkout of it contains every change in the stack. */
export function stackTopBranch(pr: PrContext): string | undefined {
  return stackReviewEntries(pr)?.at(-1)?.headBranch;
}

export interface BranchStackSource {
  /** Open PRs of the repository matching a search such as `is:pr is:open head:<branch>`. */
  search(query: string): Promise<PrListItem[]>;
  /** Head and base branch of a PR (and the head's owner, which differs for forks). */
  facts(pr: PrKey): Promise<PrPageFacts>;
}

const MAX_DEPTH = 8;

/**
 * The PRs chained to `current` by branches: below it the open PR whose head is its base (and so
 * on down), above it the open PRs whose base is its head (and so on up; the walk up stops where
 * the chain forks). Branches only count in the PR's own repository, a fork's branch is no base.
 * Undefined when no other PR is chained, the branches are unknown, or a lookup fails.
 */
export async function discoverBranchStack(
  current: PrKey & { title: string },
  source: BranchStackSource,
): Promise<PrStack | undefined> {
  const repo = { host: current.host, owner: current.owner, repo: current.repo };
  const sameRepo = (facts: PrPageFacts) =>
    !facts.headOwner || facts.headOwner.toLowerCase() === current.owner.toLowerCase();
  const key = (number: number): PrKey => ({ ...repo, number });
  try {
    const self = await source.facts(current);
    if (!self.headBranch || !self.baseBranch) return undefined;
    const seen = new Set([current.number]);

    const below: PrStackEntry[] = [];
    let base = self.baseBranch;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const hits = (await source.search(`is:pr is:open head:${base}`)).filter((hit) => !seen.has(hit.number));
      let parent: { hit: PrListItem; facts: PrPageFacts } | undefined;
      for (const hit of hits) {
        const facts = await source.facts(key(hit.number));
        if (facts.headBranch === base && sameRepo(facts)) {
          parent = { hit, facts };
          break;
        }
      }
      if (!parent) break;
      seen.add(parent.hit.number);
      const entry: PrStackEntry = {
        number: parent.hit.number,
        title: parent.hit.title,
        headBranch: base,
        state: "open",
      };
      if (parent.facts.baseBranch) entry.baseBranch = parent.facts.baseBranch;
      below.unshift(entry);
      if (!parent.facts.baseBranch) break;
      base = parent.facts.baseBranch;
    }

    const above: PrStackEntry[] = [];
    // A PR from a fork has no branch in this repository that others could build on.
    let head: string | undefined = sameRepo(self) ? self.headBranch : undefined;
    for (let depth = 0; head && depth < MAX_DEPTH; depth++) {
      const parentHead: string = head;
      const hits = (await source.search(`is:pr is:open base:${parentHead}`)).filter(
        (hit) => !seen.has(hit.number),
      );
      const children: Array<{ hit: PrListItem; facts: PrPageFacts }> = [];
      for (const hit of hits) {
        const facts = await source.facts(key(hit.number));
        if (facts.baseBranch === parentHead) children.push({ hit, facts });
      }
      for (const child of children) {
        seen.add(child.hit.number);
        const entry: PrStackEntry = {
          number: child.hit.number,
          title: child.hit.title,
          baseBranch: parentHead,
          state: "open",
        };
        if (child.facts.headBranch) entry.headBranch = child.facts.headBranch;
        above.push(entry);
      }
      const only = children.length === 1 ? children[0] : undefined;
      head = only && sameRepo(only.facts) ? only.facts.headBranch : undefined;
    }

    if (below.length === 0 && above.length === 0) return undefined;
    const pulls: PrStackEntry[] = [
      ...below,
      {
        number: current.number,
        title: current.title,
        headBranch: self.headBranch,
        baseBranch: self.baseBranch,
        state: "open",
      },
      ...above,
    ];
    const stack: PrStack = { source: "branches", pulls };
    const bottomBase = pulls[0]?.baseBranch;
    if (bottomBase) stack.baseBranch = bottomBase;
    return stack;
  } catch {
    return undefined;
  }
}
