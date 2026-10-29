/**
 * Where the extension attaches to GitHub's DOM. Selectors are isolated here so GitHub
 * markup changes only need fixing in one place; a floating fallback keeps the feature usable.
 */

export const HEADER_ACTIONS_SELECTORS = [
  ".gh-header-actions",
  "[data-testid='pr-header-actions']",
  ".gh-header-show .gh-header-actions",
  "#partial-discussion-header .gh-header-actions",
];

export const COMMENT_ROOT_SELECTORS = [
  ".review-comment",
  ".timeline-comment",
  "[data-testid='review-thread-comment']",
  "[data-testid='comment']",
];

export const COMMENT_ACTIONS_SELECTORS = [
  ".timeline-comment-actions",
  ".review-comment .timeline-comment-actions",
  "[data-testid='comment-header-right-side-items']",
  "[data-testid='comment-header-actions']",
];

export function findHeaderActions(): Element | undefined {
  for (const selector of HEADER_ACTIONS_SELECTORS) {
    const node = document.querySelector(selector);
    if (node) return node;
  }
  return undefined;
}

export function findCommentRoot(node: Element): Element | undefined {
  for (const selector of COMMENT_ROOT_SELECTORS) {
    const root = node.closest(selector);
    if (root) return root;
  }
  return undefined;
}

export function findCommentActionContainers(root: ParentNode = document): Element[] {
  const result: Element[] = [];
  for (const selector of COMMENT_ACTIONS_SELECTORS) {
    for (const node of root.querySelectorAll(selector)) {
      if (!result.includes(node)) result.push(node);
    }
  }
  return result;
}
