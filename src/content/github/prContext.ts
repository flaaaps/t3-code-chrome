import type { PrContext } from "@shared/models";
import type { PrLocation } from "@shared/prKey";
import { prUrl } from "@shared/prKey";

function text(selector: string, root: ParentNode = document): string | undefined {
  const value = root.querySelector(selector)?.textContent?.trim();
  return value ? value : undefined;
}

function branchFromRefs(): { head?: string; base?: string } {
  const strip = (value?: string | null) => {
    const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!trimmed) return undefined;
    // Fork refs are rendered as "owner:branch"; the branch itself is what we need.
    return trimmed.includes(":") ? trimmed.slice(trimmed.lastIndexOf(":") + 1).trim() : trimmed;
  };
  const result: { head?: string; base?: string } = {};
  const ownNodes = (node: Element) => !!node.closest("#t3-code-chrome-host, #t3-code-chrome-trigger");
  const refs = [...document.querySelectorAll<HTMLElement>(".commit-ref, .head-ref, .base-ref")].filter(
    (node) => !ownNodes(node),
  );
  const explicitHead = refs.find((node) => node.classList.contains("head-ref"));
  const explicitBase = refs.find((node) => node.classList.contains("base-ref"));
  const base = strip(explicitBase?.textContent) ?? strip(refs[0]?.textContent);
  const head =
    strip(explicitHead?.textContent) ??
    refs
      .filter((node) => !node.classList.contains("base-ref") && !node.querySelector(".base-ref"))
      .map((node) => strip(node.textContent))
      .find((text) => text !== undefined && text !== base);
  if (base) result.base = base;
  if (head) result.head = head;
  if (result.head && result.base) return result;
  // Fallback: the header sentence "wants to merge N commits into base from head".
  const sentence =
    refs[0]?.parentElement?.textContent ??
    document.querySelector(".gh-header-meta, [data-testid='pr-header-meta']")?.textContent ??
    "";
  const match = /into\s+(\S+)\s+from\s+(\S+)/.exec(sentence.replace(/\s+/g, " "));
  if (match) {
    if (!result.base) result.base = strip(match[1]);
    if (!result.head) result.head = strip(match[2]);
  }
  return result;
}

/** Read what the page knows about the PR; everything is optional except the key and title. */
export function readPrContext(location: PrLocation): PrContext {
  const titleNode = document.querySelector<HTMLElement>(
    ".js-issue-title, [data-testid='issue-title'], bdi.js-issue-title, h1 bdi",
  );
  const title =
    titleNode?.textContent?.trim() ||
    document.title
      .replace(/ by .*$/, "")
      .replace(/ · Pull Request.*$/, "")
      .trim();
  const { head, base } = branchFromRefs();
  const author =
    text(".gh-header-meta .author") ??
    text('[data-testid="pr-header-meta"] a[data-hovercard-type="user"]') ??
    undefined;
  const stateNode = document.querySelector<HTMLElement>(
    ".State, [data-testid='pr-state-badge'], .gh-header-meta .State",
  );
  const state = stateNode?.textContent?.trim().toLowerCase();
  const isDraft = state === "draft";
  const reviewDecision =
    text(".js-reviews-container .merge-status-item .status-heading") ??
    text("[data-testid='review-status-heading']") ??
    undefined;
  const context: PrContext = {
    host: location.host,
    owner: location.owner,
    repo: location.repo,
    number: location.number,
    url: prUrl(location),
    title,
    isDraft,
  };
  if (head) context.headBranch = head;
  if (base) context.baseBranch = base;
  if (author) context.author = author;
  if (state) context.state = state;
  if (reviewDecision) context.reviewDecision = reviewDecision;
  return context;
}

/** Text of a review comment the user clicked "Send to T3" on, including file position if present. */
export function describeComment(commentRoot: Element): string {
  const body = commentRoot.querySelector<HTMLElement>(
    ".comment-body, [data-testid='comment-body'], .js-comment-body",
  );
  const author = commentRoot.querySelector<HTMLElement>(
    ".author, [data-testid='comment-author'] a, a.author",
  );
  const file =
    commentRoot.closest("[data-path]")?.getAttribute("data-path") ??
    commentRoot.closest(".file")?.querySelector(".file-header")?.getAttribute("data-path") ??
    undefined;
  const permalink =
    commentRoot.querySelector<HTMLAnchorElement>(
      "a.js-timestamp, a[href*='#discussion_r'], a[href*='#issuecomment-']",
    )?.href ?? undefined;
  const parts: string[] = [];
  if (author?.textContent) parts.push(`Autor: ${author.textContent.trim()}`);
  if (file) parts.push(`Datei: ${file}`);
  if (permalink) parts.push(`Link: ${permalink}`);
  const quote = (body?.textContent ?? "").trim();
  parts.push(quote.length > 2000 ? `${quote.slice(0, 2000)}…` : quote);
  return parts.join("\n");
}
