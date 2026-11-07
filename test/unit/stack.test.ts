import { describe, expect, it } from "vitest";
import type { PrContext, PrStack } from "../../src/shared/models";
import { extractEmbeddedData } from "../../src/shared/pulls";
import { parsePrStack, stackReviewEntries, stackTopBranch } from "../../src/shared/stack";
import { BUILTIN_TEMPLATES } from "../../src/shared/templates/builtin";
import { renderTemplate, usesStackReview } from "../../src/shared/templates/render";

/** Shaped like the `react-app.embeddedData` of a PR page in the new PR experience (November 2026). */
function prPage(number: number, stack: unknown): string {
  const payload = {
    payload: {
      pullRequestsLayoutRoute: {
        pullRequest: { number, headBranch: "x", baseBranch: "y", state: "OPEN" },
        pageTitle: "…",
        stack,
      },
    },
  };
  return `<react-app app-name="repo"><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify(payload)}</script></react-app>`;
}

const pull = (number: number, state: string, headBranch: string) => ({
  isInAutoMergeRange: false,
  isUnstackable: true,
  title: `PR ${number}`,
  titleHtml: `PR ${number}`,
  number,
  state,
  url: `/acme/widgets/pull/${number}`,
  headBranch,
  headOid: "0000",
});

// GitHub lists the stack top first; `position` counts from the bottom.
const STACK = {
  id: 3002507,
  baseBranch: "main",
  number: 1170,
  position: 2,
  size: 4,
  pulls: [
    pull(1165, "OPEN", "d"),
    pull(1163, "OPEN", "c"),
    pull(1162, "OPEN", "b"),
    pull(1161, "MERGED", "a"),
  ],
};

const context = (number: number, stack?: PrStack): PrContext => ({
  host: "github.com",
  owner: "acme",
  repo: "widgets",
  number,
  url: `https://github.com/acme/widgets/pull/${number}`,
  title: `PR ${number}`,
  headBranch: "b",
  baseBranch: "main",
  ...(stack ? { stack } : {}),
});

describe("parsePrStack", () => {
  it("reads the stack bottom first from the embedded page data", () => {
    const stack = parsePrStack(extractEmbeddedData(prPage(1162, STACK)), 1162);
    expect(stack).toEqual({
      baseBranch: "main",
      pulls: [
        { number: 1161, title: "PR 1161", headBranch: "a", state: "merged" },
        { number: 1162, title: "PR 1162", headBranch: "b", state: "open" },
        { number: 1163, title: "PR 1163", headBranch: "c", state: "open" },
        { number: 1165, title: "PR 1165", headBranch: "d", state: "open" },
      ],
    });
  });

  it("tells 'no stack' (null) apart from data for another PR (undefined)", () => {
    expect(parsePrStack(extractEmbeddedData(prPage(1190, null)), 1190)).toBeNull();
    expect(parsePrStack(extractEmbeddedData(prPage(1162, STACK)), 1165)).toBeUndefined();
    expect(parsePrStack([], 1162)).toBeUndefined();
  });
});

describe("stack review", () => {
  const stack = parsePrStack(extractEmbeddedData(prPage(1162, STACK)), 1162) as PrStack;

  it("lists the open PRs with the branch each one merges into", () => {
    const entries = stackReviewEntries(context(1162, stack));
    expect(entries?.map((e) => [e.number, e.headBranch, e.baseBranch, e.current])).toEqual([
      // #1161 is merged, so #1162 now merges into the stack's base.
      [1162, "b", "main", true],
      [1163, "c", "b", false],
      [1165, "d", "c", false],
    ]);
    expect(stackTopBranch(context(1162, stack))).toBe("d");
  });

  it("needs the PR itself open and at least one other open PR", () => {
    expect(stackReviewEntries(context(1162))).toBeUndefined();
    expect(stackReviewEntries(context(1161, stack))).toBeUndefined();
    const lonely: PrStack = { baseBranch: "main", pulls: [{ number: 1, title: "a", state: "open" }] };
    expect(stackReviewEntries(context(1, lonely))).toBeUndefined();
  });

  it("puts the stack into the review prompt, and leaves it out when switched off", () => {
    const review = BUILTIN_TEMPLATES.find((t) => t.id === "builtin:review");
    if (!review) throw new Error("review template missing");
    expect(usesStackReview(review.body)).toBe(true);

    const withStack = renderTemplate(review.body, { pr: context(1162, stack) });
    expect(withStack).toContain("Reviewe den ganzen Stack, nicht nur #1162");
    expect(withStack).toContain(
      "1. #1162 „PR 1162“ (`b` → `main`), https://github.com/acme/widgets/pull/1162 ← diese Seite",
    );
    expect(withStack).toContain("3. #1165 „PR 1165“ (`d` → `c`), https://github.com/acme/widgets/pull/1165");
    expect(withStack).toContain("`link_pull_requests`");
    expect(withStack).not.toContain("1161");

    const off = renderTemplate(review.body, { pr: context(1162, stack), reviewStack: false });
    const none = renderTemplate(review.body, { pr: context(1162) });
    expect(off).toBe(none);
    expect(none).not.toContain("Stack");
    expect(none).not.toMatch(/\n{3,}/);
  });
});
