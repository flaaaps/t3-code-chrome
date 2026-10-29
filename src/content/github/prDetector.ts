import { type PrLocation, parsePrUrl, prKeyEquals } from "@shared/prKey";

export type PrListener = (location: PrLocation | undefined) => void;

/**
 * Watch GitHub's client-side navigation (Turbo) and report the current PR, if any. The host is not
 * checked: the content script is only injected into GitHub and GitHub Enterprise pages.
 * Fires immediately with the current state.
 */
export function watchPrLocation(listener: PrListener): () => void {
  let current = parsePrUrl(window.location.href, "any");
  let currentHref = window.location.href;
  listener(current);

  const check = () => {
    if (window.location.href === currentHref) return;
    currentHref = window.location.href;
    const next = parsePrUrl(currentHref, "any");
    const changed = !prKeyEquals(current, next) || current?.tab !== next?.tab;
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
