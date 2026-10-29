/**
 * Where the extension attaches to GitHub's DOM. Selectors live here so markup changes only need
 * fixing in one place; every mount has a visible, non-floating fallback.
 */

const HEADER_ACTIONS_SELECTORS = [
  ".gh-header-actions",
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

/** Element after which the Agent-Box is inserted (the PR header block); falls back to the timeline. */
export function findAgentBoxAnchor(): { node: Element; position: "after" | "before" } | undefined {
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

export function findCommentActionContainers(root: ParentNode = document): Element[] {
  const result: Element[] = [];
  for (const selector of COMMENT_ACTIONS_SELECTORS) {
    for (const node of root.querySelectorAll(selector)) if (!result.includes(node)) result.push(node);
  }
  return result;
}
