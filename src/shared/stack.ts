/**
 * Native GitHub PR stacks. A server-rendered PR page embeds the stack next to the PR
 * (`payload.pullRequestsLayoutRoute.{pullRequest, stack}`); `stack` is `null` for a PR outside a stack.
 * No DOM access, so it runs in tests and workers.
 */
import type { PrContext, PrStack, PrStackEntry } from "./models";
import { prUrl } from "./prKey";

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
    const stack: PrStack = { pulls };
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
    const base = below ? below.headBranch : pr.stack?.baseBranch;
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
