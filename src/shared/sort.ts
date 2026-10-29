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
  const byTitle = projects.find((p) => p.title.toLowerCase() === pr.repo.toLowerCase());
  return byTitle;
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
  return new RegExp(`(?:#|pull/)${pr.number}(?!\\d)`).test(thread.title);
}

export interface RankedThread {
  thread: ThreadSummary;
  rank: 0 | 1 | 2 | 3;
  reason: "linked-pr" | "same-project-active" | "same-project" | "other";
}

/**
 * Rank threads for a PR: linked to this PR first, then active threads of the matching project,
 * then settled threads of the project, then everything else. Within a rank, newest first.
 */
export function rankThreads(
  threads: ThreadSummary[],
  pr: PrKey,
  projectId: string | undefined,
): RankedThread[] {
  const ranked: RankedThread[] = threads.map((thread) => {
    if (threadMentionsPr(thread, pr) || threadMentionsPrInTitle(thread, pr)) {
      return { thread, rank: 0, reason: "linked-pr" };
    }
    if (projectId && thread.projectId === projectId) {
      if (ACTIVE_THREAD_STATUSES.has(thread.status))
        return { thread, rank: 1, reason: "same-project-active" };
      return { thread, rank: 2, reason: "same-project" };
    }
    return { thread, rank: 3, reason: "other" };
  });
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
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
