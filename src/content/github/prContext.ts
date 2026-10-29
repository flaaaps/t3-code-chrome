import type { CommentContext, PrContext } from "@shared/models";
import type { PrLocation } from "@shared/prKey";
import { prUrl } from "@shared/prKey";

const OWN_HOSTS =
  "#t3-code-chrome-host, #t3-code-chrome-trigger, #t3-code-chrome-agentbox, .t3-code-chrome-comment";

function isOwn(node: Element | null | undefined): boolean {
  return !!node?.closest(OWN_HOSTS);
}

function text(selector: string, root: ParentNode = document): string | undefined {
  for (const node of root.querySelectorAll<HTMLElement>(selector)) {
    if (isOwn(node)) continue;
    const value = node.textContent?.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}

function stripOwnerPrefix(value?: string | null): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed) return undefined;
  return trimmed.includes(":") ? trimmed.slice(trimmed.lastIndexOf(":") + 1).trim() : trimmed;
}

function branchFromRefs(): { head?: string; base?: string } {
  const result: { head?: string; base?: string } = {};
  const refs = [...document.querySelectorAll<HTMLElement>(".commit-ref, .head-ref, .base-ref")].filter(
    (node) => !isOwn(node),
  );
  const explicitHead = refs.find((node) => node.classList.contains("head-ref"));
  const explicitBase = refs.find((node) => node.classList.contains("base-ref"));
  const base = stripOwnerPrefix(explicitBase?.textContent) ?? stripOwnerPrefix(refs[0]?.textContent);
  const head =
    stripOwnerPrefix(explicitHead?.textContent) ??
    refs
      .filter((node) => !node.classList.contains("base-ref") && !node.querySelector(".base-ref"))
      .map((node) => stripOwnerPrefix(node.textContent))
      .find((value) => value !== undefined && value !== base);
  if (base) result.base = base;
  if (head) result.head = head;
  if (result.head && result.base) return result;
  const sentence =
    refs[0]?.parentElement?.textContent ??
    document.querySelector(".gh-header-meta, [data-testid='pr-header-meta']")?.textContent ??
    "";
  const match = /into\s+(\S+)\s+from\s+(\S+)/.exec(sentence.replace(/\s+/g, " "));
  if (match) {
    if (!result.base) result.base = stripOwnerPrefix(match[1]);
    if (!result.head) result.head = stripOwnerPrefix(match[2]);
  }
  return result;
}

function checks(): { state: PrContext["checksState"]; failed: string[] } {
  const failed: string[] = [];
  const headings = [
    ...document.querySelectorAll<HTMLElement>(
      ".merge-status-item .status-heading, .branch-action-item .h4, [data-testid='checks-status-heading'], [data-testid='merge-box'] h3, .mergeability-details h3, [class*='MergeBox'] h3",
    ),
  ]
    .filter((node) => !isOwn(node))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "");
  const joined = headings.join(" | ").toLowerCase();
  for (const item of document.querySelectorAll<HTMLElement>(
    ".merge-status-item.status-fail, .merge-status-list .merge-status-item:has(.octicon-x), [data-testid='checks-list'] li:has([aria-label*='fail' i])",
  )) {
    const name = item
      .querySelector(".text-emphasized, strong, [data-testid='check-name']")
      ?.textContent?.trim();
    if (name && !failed.includes(name)) failed.push(name);
  }
  let state: PrContext["checksState"] = "unknown";
  if (
    /not successful|failing|failed|fehlgeschlagen|some checks were not/i.test(joined) ||
    failed.length > 0
  ) {
    state = "failure";
  } else if (/all checks have passed|checks passed|erfolgreich/i.test(joined)) {
    state = "success";
  } else if (/in progress|pending|queued|waiting for/i.test(joined)) {
    state = "pending";
  }
  return { state, failed };
}

/** Read what the page knows about the PR; everything is optional except the key and title. */
export function readPrContext(location: PrLocation): PrContext {
  const titleNode = [
    ...document.querySelectorAll<HTMLElement>(
      ".js-issue-title, [data-testid='issue-title'], bdi.js-issue-title, h1 bdi",
    ),
  ].find((node) => !isOwn(node));
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
    text(".pull-discussion-timeline .timeline-comment-header .author");
  const viewer = document.querySelector<HTMLMetaElement>("meta[name='user-login']")?.content || undefined;
  const stateNode = [
    ...document.querySelectorAll<HTMLElement>(
      ".State, [data-testid='pr-state-badge'], [data-testid='header-state']",
    ),
  ].find((node) => !isOwn(node));
  const state = stateNode?.textContent?.replace(/\s+/g, " ").trim().toLowerCase();
  const isDraft = state === "draft" || /draft/i.test(state ?? "");
  const reviewDecision =
    text(".js-reviews-container .merge-status-item .status-heading") ??
    text("[data-testid='review-status-heading']") ??
    [
      ...document.querySelectorAll<HTMLElement>(
        ".merge-status-item .status-heading, [data-testid='merge-box'] h3",
      ),
    ]
      .map((node) => node.textContent?.trim() ?? "")
      .find((value) => /changes requested|approved|review required/i.test(value));
  const description = [
    ...document.querySelectorAll<HTMLElement>(
      ".pull-discussion-timeline .timeline-comment .comment-body, [data-testid='issue-body'] .markdown-body, .js-issue-body .comment-body",
    ),
  ]
    .find((node) => !isOwn(node))
    ?.textContent?.replace(/\n{3,}/g, "\n\n")
    .trim();
  const filesTab = text("a[href$='/files'] .Counter, [data-testid='files-tab-counter']");
  const changedFilesCount = filesTab ? Number.parseInt(filesTab.replace(/\D/g, ""), 10) : Number.NaN;
  const { state: checksState, failed } = checks();

  const context: PrContext = {
    host: location.host,
    owner: location.owner,
    repo: location.repo,
    number: location.number,
    url: prUrl(location),
    title,
    isDraft,
    checksState: checksState ?? "unknown",
  };
  if (head) context.headBranch = head;
  if (base) context.baseBranch = base;
  if (author) context.author = author.replace(/^@/, "");
  if (viewer) context.viewer = viewer;
  if (state) context.state = state;
  if (reviewDecision) context.reviewDecision = reviewDecision;
  if (description) context.description = description.slice(0, 4000);
  if (Number.isFinite(changedFilesCount)) context.changedFilesCount = changedFilesCount;
  if (failed.length > 0) context.failedChecks = failed;
  return context;
}

/** Structured description of a review comment the user acted on. */
export function describeComment(commentRoot: Element): CommentContext {
  const body = commentRoot.querySelector<HTMLElement>(
    ".comment-body, [data-testid='comment-body'], .js-comment-body",
  );
  const author =
    commentRoot
      .querySelector<HTMLElement>(".author, [data-testid='comment-author'] a, a.author")
      ?.textContent?.trim() ?? undefined;
  const fileNode =
    commentRoot.closest<HTMLElement>("[data-path]") ??
    commentRoot.closest(".file")?.querySelector<HTMLElement>("[data-path]");
  const file =
    fileNode?.getAttribute("data-path") ??
    commentRoot.closest(".file")?.querySelector(".file-info a")?.textContent?.trim();
  const line =
    commentRoot
      .closest("tr")
      ?.previousElementSibling?.querySelector("[data-line-number]")
      ?.getAttribute("data-line-number") ??
    commentRoot.closest("[data-line]")?.getAttribute("data-line") ??
    undefined;
  const permalink =
    commentRoot.querySelector<HTMLAnchorElement>(
      "a.js-timestamp, a[href*='#discussion_r'], a[href*='#issuecomment-'], a[href*='#pullrequestreview-']",
    )?.href ?? undefined;
  const rawText = (body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  const result: CommentContext = { text: rawText.length > 2000 ? `${rawText.slice(0, 2000)}…` : rawText };
  if (author) result.author = author.replace(/^@/, "");
  if (file) result.file = file;
  if (line) result.line = line;
  if (permalink) result.url = permalink;
  return result;
}

/** Free-text selection turned into a comment context (context menu / selection action). */
export function commentFromSelection(selection: string): CommentContext {
  return { text: selection.trim() };
}
