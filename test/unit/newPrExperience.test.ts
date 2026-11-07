// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  commentMenuSlot,
  findAgentBoxAnchor,
  findCommentActionContainers,
  findCommentRoot,
  findHeaderActions,
  isIssueBody,
} from "../../src/content/github/mountPoints";
import { describeComment, readPrContext } from "../../src/content/github/prContext";
import { isolateKeyboard } from "../../src/content/ui/keyboard";

/**
 * Trimmed from github.com's opt-in PR experience (Primer React, November 2026). Class names keep
 * Primer's stable prefixes; the hashed suffixes are made up, like the ones GitHub rotates.
 */
const NEW_PR_PAGE = `
<meta name="user-login" content="flaaaps">
<main>
<div class="prc-PageLayout-PageLayoutRoot--x1">
  <div class="prc-PageLayout-PageLayoutWrapper-x2">
    <header class="prc-PageLayout-Header-x3">
      <div class="prc-PageLayout-HeaderContent-x4">
        <div class="headerBorderBottom__x5">
          <div class="prc-PageHeader-PageHeader-x6">
            <div class="prc-PageHeader-TitleArea-x7">
              <h1><span class="f1 markdown-title">Run E2E staging on the kube runner</span><span class="sr-only"> - #1185</span></h1>
            </div>
            <div class="prc-PageHeader-Actions-x8 gap-2">
              <button aria-label="Code">Code</button>
            </div>
            <div class="prc-PageHeader-Description-x9">
              <span data-component="StateLabel" class="prc-StateLabel-StateLabel-xa">Open</span>
              <a data-hovercard-type="user" href="/flaaaps">flaaaps</a>
              <span class="baseBranchGroup__xb"><a class="prc-BranchName-BranchName-xc" href="/a/b/tree/develop">develop</a></span>
              <span class="headBranchGroup__xd"><a class="prc-BranchName-BranchName-xc" href="/a/b/tree/ci/kube">ci/kube</a></span>
            </div>
            <nav aria-label="Pull request">
              <a id="prs-files-anchor-tab" href="/a/b/pull/1185/changes">Files changed <span class="prc-CounterLabel-CounterLabel-xe">7</span></a>
            </nav>
          </div>
        </div>
      </div>
    </header>
    <div class="prc-PageLayout-PageLayoutContent-xf">
      <section data-testid="mini-status" aria-label="Expand checks"><strong>Checks</strong><span>4/4</span><span class="prc-TooltipV2-Tooltip-xg">3 successful checks</span></section>
      <section data-testid="mini-status" aria-label="View approvals"><strong>Approvals</strong><span class="prc-TooltipV2-Tooltip-xg">1 approval received</span></section>
      <section aria-label="Description"><div class="markdown-body">Moves the staging run into the cluster.</div></section>
      <article id="issuecomment-1" class="container__xh">
        <div data-testid="comment-header">
          <a data-testid="avatar-link" href="/flaaaps">flaaaps</a>
          <a href="https://github.com/a/b/pull/1185#issuecomment-1">today</a>
          <div data-testid="comment-header-right-side-items">
            <div class="BadgesContainer__xi">
              <div class="ActionsButtonsContainer__xj"><button aria-label="More actions">…</button></div>
            </div>
          </div>
        </div>
        <div class="markdown-body">Addressed the review.</div>
      </article>
      <article class="container__xh">
        <div><div><h2><a href="/a/b/pull/1185/changes#r9">&#x200e;.github/workflows/e2e-staging.yml&#x200e;</a><span>Line 40</span></h2></div></div>
        <div data-testid="review-thread">
          <div id="discussion_r9">
            <div data-testid="comment-header">
              <a data-testid="avatar-link" href="/bot">studypilot-ci</a>
              <a href="https://github.com/a/b/pull/1185#discussion_r9">yesterday</a>
              <div data-testid="comment-header-right-side-items">
                <div class="ActionsButtonsContainer__xj"><button aria-label="More actions">…</button></div>
              </div>
            </div>
            <div class="markdown-body">Pin the runner image.</div>
          </div>
        </div>
      </article>
    </div>
  </div>
</div>
</main>`;

const location = { host: "github.com", owner: "a", repo: "b", number: 1185, tab: "conversation" as const };

beforeEach(() => {
  document.body.innerHTML = NEW_PR_PAGE;
});

describe("mount points in the new PR experience", () => {
  it("finds the header actions and puts the Agent-Box at the end of the page header", () => {
    expect(findHeaderActions()?.className).toContain("prc-PageHeader-Actions");
    const anchor = findAgentBoxAnchor();
    expect(anchor?.position).toBe("append");
    expect(anchor?.node.className).toContain("prc-PageLayout-HeaderContent");
  });

  it("ignores the hidden, empty action row GitHub renders when logged out", () => {
    findHeaderActions()?.classList.add("d-none");
    expect(findHeaderActions()).toBeUndefined();
  });

  it("resolves comment roots and places the menu before GitHub's own buttons", () => {
    const containers = findCommentActionContainers();
    expect(containers).toHaveLength(2);
    const roots = containers.map((c) => findCommentRoot(c));
    expect(roots.map((r) => r?.id)).toEqual(["issuecomment-1", "discussion_r9"]);
    expect(roots.some((r) => r && isIssueBody(r))).toBe(false);
    const slot = commentMenuSlot(containers[0] as Element);
    expect(slot.parent.className).toContain("ActionsButtonsContainer");
    expect((slot.before as Element).getAttribute("aria-label")).toBe("More actions");
  });
});

describe("PR context in the new PR experience", () => {
  it("reads title, branches, state, checks and description", () => {
    const context = readPrContext(location);
    expect(context).toMatchObject({
      title: "Run E2E staging on the kube runner",
      baseBranch: "develop",
      headBranch: "ci/kube",
      author: "flaaaps",
      viewer: "flaaaps",
      state: "open",
      isDraft: false,
      checksState: "success",
      reviewDecision: "1 approval received",
      description: "Moves the staging run into the cluster.",
      changedFilesCount: 7,
    });
  });

  it("describes a review-thread comment with file, line and permalink", () => {
    const root = document.getElementById("discussion_r9") as Element;
    expect(describeComment(root)).toEqual({
      text: "Pin the runner image.",
      author: "studypilot-ci",
      file: ".github/workflows/e2e-staging.yml",
      line: "40",
      url: "https://github.com/a/b/pull/1185#discussion_r9",
    });
  });
});

describe("isolateKeyboard", () => {
  it("keeps typing in the shadow tree away from page-level shortcut listeners", () => {
    const host = document.createElement("div");
    const textarea = document.createElement("textarea");
    host.attachShadow({ mode: "open" }).appendChild(textarea);
    document.body.appendChild(host);
    isolateKeyboard(host);

    const seenByPage: string[] = [];
    const seenByExtension: string[] = [];
    document.addEventListener("keydown", (event) => seenByPage.push(event.key));
    document.addEventListener("keydown", (event) => seenByExtension.push(event.key), true);
    textarea.addEventListener("keydown", (event) => seenByExtension.push(`field:${event.key}`));

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true, composed: true }));
    expect(seenByPage).toEqual([]);
    expect(seenByExtension).toEqual(["?", "field:?"]);
  });
});
