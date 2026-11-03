import {
  type PrLocation,
  parsePrUrl,
  parsePullsUrl,
  prKeyEquals,
  type RepoKey,
  repoKeyEquals,
} from "@shared/prKey";

/** The kind of GitHub page the extension cares about. */
export type PageLocation = { kind: "pr"; pr: PrLocation } | { kind: "pulls"; repo: RepoKey };

export type LocationListener = (location: PageLocation | undefined) => void;

export function parsePageLocation(href: string): PageLocation | undefined {
  const pr = parsePrUrl(href, "any");
  if (pr) return { kind: "pr", pr };
  const repo = parsePullsUrl(href, "any");
  if (repo) return { kind: "pulls", repo };
  return undefined;
}

/** Same page for the extension's purposes: same PR and tab, or the same repository's PR list. */
export function samePage(a: PageLocation | undefined, b: PageLocation | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "pr" && b.kind === "pr") return prKeyEquals(a.pr, b.pr) && a.pr.tab === b.pr.tab;
  if (a.kind === "pulls" && b.kind === "pulls") return repoKeyEquals(a.repo, b.repo);
  return false;
}

/**
 * Watch GitHub's client-side navigation (Turbo, and the React data router's `pushState`) and report
 * the current PR or PR list, if any. Filter or page changes on the PR list (`?q=`, `?page=`) do not
 * count as a change. The host is not checked: the content script only runs on GitHub pages.
 * Fires immediately with the current state.
 */
export function watchLocation(listener: LocationListener): () => void {
  let current = parsePageLocation(window.location.href);
  let currentHref = window.location.href;
  listener(current);

  const check = () => {
    if (window.location.href === currentHref) return;
    currentHref = window.location.href;
    const next = parsePageLocation(currentHref);
    const changed = !samePage(current, next);
    current = next;
    if (changed) listener(next);
  };

  const onTurbo = () => queueMicrotask(check);
  document.addEventListener("turbo:load", onTurbo);
  document.addEventListener("turbo:render", onTurbo);
  document.addEventListener("pjax:end", onTurbo);
  window.addEventListener("popstate", onTurbo);

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    queueMicrotask(check);
  };
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    queueMicrotask(check);
  };
  const interval = window.setInterval(check, 1500);

  return () => {
    document.removeEventListener("turbo:load", onTurbo);
    document.removeEventListener("turbo:render", onTurbo);
    document.removeEventListener("pjax:end", onTurbo);
    window.removeEventListener("popstate", onTurbo);
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.clearInterval(interval);
  };
}
