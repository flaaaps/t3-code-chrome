import { ACTIVE_THREAD_STATUSES, type Project, type ThreadSummary } from "./models";
import { normaliseRepoIdentifier, type PrKey, repoCanonicalKey } from "./prKey";

/** Pick the project whose repository matches the PR's repository. */
export function matchProject(projects: Project[], pr: PrKey): Project | undefined {
  const wanted = repoCanonicalKey(pr);
  const exact = projects.find((p) => normaliseRepoIdentifier(p.canonicalKey) === wanted);
  if (exact) return exact;
  const ownerRepo = `${pr.owner}/${pr.repo}`.toLowerCase();
  const byName = projects.find((p) => p.repoDisplayName?.toLowerCase() === ownerRepo);
  if (byName) return byName;
  return projects.find((p) => p.title.toLowerCase() === pr.repo.toLowerCase());
}

export function threadMentionsPr(thread: ThreadSummary, pr: PrKey): boolean {
  const repo = `${pr.owner}/${pr.repo}`.toLowerCase();
  return thread.pullRequests.some(
    (link) =>
      link.number === pr.number &&
      (link.repository.toLowerCase() === repo || normaliseRepoIdentifier(link.url) === repoCanonicalKey(pr)),
  );
}

export function threadMentionsPrInTitle(thread: ThreadSummary, pr: PrKey): boolean {
  const repo = `${pr.owner}/${pr.repo}`.toLowerCase();
  const title = thread.title.toLowerCase();
  if (new RegExp(`${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#${pr.number}(?!\\d)`).test(title))
    return true;
  return new RegExp(`pull/${pr.number}(?!\\d)`).test(title);
}

export function threadIsLinked(thread: ThreadSummary, pr: PrKey): boolean {
  return threadMentionsPr(thread, pr) || threadMentionsPrInTitle(thread, pr);
}

export type ThreadGroup = "this-pr" | "project-active" | "project" | "other";

export interface RankedThread {
  thread: ThreadSummary;
  group: ThreadGroup;
}

/**
 * Rank threads for a PR: linked to this PR first, then active threads of the matching project,
 * then settled threads of the project, then everything else. Within a group, newest first.
 */
export function rankThreads(
  threads: ThreadSummary[],
  pr: PrKey,
  projectId: string | undefined,
): RankedThread[] {
  const order: Record<ThreadGroup, number> = { "this-pr": 0, "project-active": 1, project: 2, other: 3 };
  const ranked: RankedThread[] = threads.map((thread) => {
    if (threadIsLinked(thread, pr)) return { thread, group: "this-pr" };
    if (projectId && thread.projectId === projectId) {
      return { thread, group: ACTIVE_THREAD_STATUSES.has(thread.status) ? "project-active" : "project" };
    }
    return { thread, group: "other" };
  });
  ranked.sort((a, b) => {
    if (order[a.group] !== order[b.group]) return order[a.group] - order[b.group];
    return b.thread.updatedAt.localeCompare(a.thread.updatedAt);
  });
  return ranked;
}

export function sortProjects(projects: Project[], suggestedId: string | undefined): Project[] {
  return [...projects].sort((a, b) => {
    if (a.id === suggestedId) return -1;
    if (b.id === suggestedId) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
