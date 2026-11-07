/**
 * Where the extension attaches to GitHub's DOM. Selectors live here so markup changes only need
 * fixing in one place; every mount has a visible, non-floating fallback.
 */

// GitHub's new PR experience (opt-in, Primer React) has no stable ids or test ids on the header,
// so it is matched by Primer's component class prefixes. The hashed suffixes change per deploy.
const REACT_PR_HEADER = "header[class*='prc-PageLayout-Header']";

const HEADER_ACTIONS_SELECTORS = [
  ".gh-header-actions",
  // logged out, GitHub renders this row empty and hidden (`d-none`)
  `${REACT_PR_HEADER} [class*='prc-PageHeader-Actions']:not(.d-none)`,
  "[data-testid='pr-header-actions']",
  "#partial-discussion-header .gh-header-actions",
];

const HEADER_BLOCK_SELECTORS = [
  "#partial-discussion-header",
  ".gh-header",
  "[data-testid='pr-header']",
  "[data-testid='issue-header']",
];

const TIMELINE_SELECTORS = [
  ".pull-discussion-timeline",
  "#discussion_bucket",
  ".js-discussion",
  "[data-testid='issue-viewer-container']",
  "#files",
  ".pull-request-tab-content",
];

const COMMENT_ROOT_SELECTORS = [
  ".review-comment",
  ".timeline-comment",
  "[data-testid='review-thread-comment']",
  "[data-testid='comment']",
  // new PR experience: one comment in a review thread, then a top-level comment or review
  "[id^='discussion_r']",
  "article[id^='issuecomment-']",
  "article[id^='pullrequestreview-']",
];

const COMMENT_ACTIONS_SELECTORS = [
  ".timeline-comment-actions",
  "[data-testid='comment-header-right-side-items']",
  "[data-testid='comment-header-actions']",
];

function first(selectors: string[], root: ParentNode = document): Element | undefined {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node) return node;
  }
  return undefined;
}

export function findHeaderActions(): Element | undefined {
  return first(HEADER_ACTIONS_SELECTORS);
}

export interface Anchor {
  node: Element;
  /** `after`/`before`: sibling of `node`; `append`: last child of `node`. */
  position: "after" | "before" | "append";
}

/**
 * Where the Agent-Box goes: after the PR header block. In the new PR experience that is the end of
 * the page header, right under the tab navigation, at content width on every tab. Falls back to
 * the timeline.
 */
export function findAgentBoxAnchor(): Anchor | undefined {
  const reactHeader = document.querySelector(`${REACT_PR_HEADER} > [class*='prc-PageLayout-HeaderContent']`);
  if (reactHeader) return { node: reactHeader, position: "append" };
  const header = first(HEADER_BLOCK_SELECTORS);
  if (header) return { node: header, position: "after" };
  const timeline = first(TIMELINE_SELECTORS);
  if (timeline) return { node: timeline, position: "before" };
  const main = document.querySelector("main, #js-repo-pjax-container");
  return main ? { node: main, position: "before" } : undefined;
}

/** Row under the PR title used when the header action bar is missing (logged-out layout). */
export function findTitleRow(): Element | undefined {
  const title = document.querySelector(".gh-header-title, [data-testid='issue-title'], h1 bdi");
  return title?.closest(".gh-header-show, .gh-header-title, h1") ?? title?.parentElement ?? undefined;
}

export function findCommentRoot(node: Element): Element | undefined {
  for (const selector of COMMENT_ROOT_SELECTORS) {
    const root = node.closest(selector);
    if (root) return root;
  }
  return undefined;
}

/** Is this comment the PR description (issue body) rather than a review or discussion comment? */
export function isIssueBody(root: Element): boolean {
  if (root.id.startsWith("pullrequest-") || root.id.startsWith("issue-")) return true;
  if (root.closest(".js-issue-body, [data-testid='issue-body']")) return true;
  const timeline = root.closest(".pull-discussion-timeline, .js-discussion");
  if (timeline) {
    const firstComment = timeline.querySelector(".timeline-comment");
    if (firstComment === root) return true;
  }
  return false;
}

/**
 * Where the comment menu goes inside a comment's action container: before GitHub's own buttons
 * (the `…` menu) in the new PR experience, otherwise first in the container.
 */
export function commentMenuSlot(container: Element): { parent: Element; before: Node | null } {
  const buttons = container.querySelector("[class*='ActionsButtonsContainer']");
  if (buttons) return { parent: buttons, before: buttons.firstChild };
  return { parent: container, before: container.firstChild };
}

export function findCommentActionContainers(root: ParentNode = document): Element[] {
  const result: Element[] = [];
  for (const selector of COMMENT_ACTIONS_SELECTORS) {
    for (const node of root.querySelectorAll(selector)) if (!result.includes(node)) result.push(node);
  }
  return result;
}
