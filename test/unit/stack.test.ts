import { describe, expect, it } from "vitest";
import type { PrContext, PrStack } from "../../src/shared/models";
import { extractEmbeddedData } from "../../src/shared/pulls";
import {
  type BranchStackSource,
  discoverBranchStack,
  parsePrStack,
  stackReviewEntries,
  stackTopBranch,
} from "../../src/shared/stack";
import { BUILTIN_TEMPLATES } from "../../src/shared/templates/builtin";
import { renderTemplate, templateBody, usesStackReview } from "../../src/shared/templates/render";

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
      source: "native",
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
    const lonely: PrStack = {
      source: "native",
      baseBranch: "main",
      pulls: [{ number: 1, title: "a", state: "open" }],
    };
    expect(stackReviewEntries(context(1, lonely))).toBeUndefined();
  });

  it("puts the stack into the review prompt, and leaves it out when switched off", () => {
    const review = BUILTIN_TEMPLATES.find((t) => t.id === "builtin:review");
    if (!review) throw new Error("review template missing");
    expect(usesStackReview(review)).toBe(true);

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

describe("discoverBranchStack", () => {
  type Pr = { number: number; head: string; base: string; headOwner?: string };
  // develop ← #1193 ← #1194 ← #1196, plus a fork PR whose branch happens to share a name.
  const PRS: Pr[] = [
    { number: 1193, head: "feature/applets/base-stylesheet", base: "develop" },
    { number: 1194, head: "feature/applets/lernapp-repo", base: "feature/applets/base-stylesheet" },
    { number: 1196, head: "feature/applets/next", base: "feature/applets/lernapp-repo" },
    { number: 1200, head: "develop", base: "develop", headOwner: "someone" },
    { number: 1201, head: "feature/applets/base-stylesheet", base: "main", headOwner: "someone" },
  ];
  const source = (prs: Pr[]): BranchStackSource => ({
    search: async (query) => {
      const [, field, branch] = /is:open (head|base):(\S+)/.exec(query) ?? [];
      return prs
        .filter((pr) => (field === "head" ? pr.head : pr.base) === branch)
        .map((pr) => ({ ...context(pr.number), isDraft: false, labels: [], roles: [] }));
    },
    facts: async (key) => {
      const pr = prs.find((p) => p.number === key.number);
      if (!pr) return {};
      return { headBranch: pr.head, baseBranch: pr.base, headOwner: pr.headOwner ?? "acme" };
    },
  });

  it("walks down to the trunk and up to the tip, ignoring forks", async () => {
    const stack = await discoverBranchStack({ ...context(1194), title: "Lernapp-Repo" }, source(PRS));
    expect(stack?.source).toBe("branches");
    expect(stack?.baseBranch).toBe("develop");
    expect(stack?.pulls.map((p) => [p.number, p.headBranch, p.baseBranch])).toEqual([
      [1193, "feature/applets/base-stylesheet", "develop"],
      [1194, "feature/applets/lernapp-repo", "feature/applets/base-stylesheet"],
      [1196, "feature/applets/next", "feature/applets/lernapp-repo"],
    ]);
    const pr = { ...context(1194, stack), title: "Lernapp-Repo" };
    expect(stackTopBranch(pr)).toBe("feature/applets/next");
    const prompt = renderTemplate("{{review.stack}}", { pr, appendContextFooter: false });
    expect(prompt).toContain(
      "1. #1193 „PR 1193“ (`feature/applets/base-stylesheet` → `develop`), https://github.com/acme/widgets/pull/1193",
    );
    expect(prompt).toContain("2. #1194 „Lernapp-Repo“");
  });

  it("returns nothing for a PR straight on the trunk without children", async () => {
    const lone: Pr[] = [{ number: 5, head: "fix/x", base: "develop" }, ...PRS.slice(3)];
    expect(await discoverBranchStack({ ...context(5), title: "x" }, source(lone))).toBeUndefined();
  });

  it("includes every child where the chain forks, and stops there", async () => {
    const forked: Pr[] = [
      { number: 1, head: "a", base: "develop" },
      { number: 2, head: "b", base: "a" },
      { number: 3, head: "c", base: "a" },
      { number: 4, head: "d", base: "b" },
    ];
    const stack = await discoverBranchStack({ ...context(1), title: "a" }, source(forked));
    expect(stack?.pulls.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("survives a branch cycle and failing lookups", async () => {
    const cycle: Pr[] = [
      { number: 1, head: "a", base: "b" },
      { number: 2, head: "b", base: "a" },
    ];
    const stack = await discoverBranchStack({ ...context(1), title: "a" }, source(cycle));
    expect(stack?.pulls.map((p) => p.number)).toEqual([2, 1]);
    const failing: BranchStackSource = {
      search: () => Promise.reject(new Error("429")),
      facts: async () => ({ headBranch: "a", baseBranch: "develop" }),
    };
    expect(await discoverBranchStack({ ...context(1), title: "a" }, failing)).toBeUndefined();
  });
});

describe("customised review templates", () => {
  const stack: PrStack = {
    source: "branches",
    baseBranch: "develop",
    pulls: [
      { number: 1193, title: "Basis", headBranch: "base", baseBranch: "develop", state: "open" },
      { number: 1194, title: "Lernapp", headBranch: "lernapp", baseBranch: "base", state: "open" },
    ],
  };
  // An override of the review action saved before `{{review.stack}}` existed.
  const custom = {
    id: "builtin:review",
    reviewOutput: true,
    body: "Lies den Skill $code-reviewer.\n\nReview {{pr.url}}.\n\nVorgehen:\n1. Diff holen.\n\n{{user.note}}",
  };

  it("get the stack paragraph before their steps", () => {
    expect(usesStackReview(custom)).toBe(true);
    const out = renderTemplate(templateBody(custom), {
      pr: context(1194, stack),
      appendContextFooter: false,
    });
    expect(out).toMatch(
      /Review https:\S+1194\.\n\nDer Pull Request ist Teil eines Stacks[\s\S]*\n\nVorgehen:\n1\. Diff holen\.$/,
    );
    expect(out).toContain("1. #1193 „Basis“");
  });

  it("stay unchanged without a stack, and other actions never get it", () => {
    const plain = renderTemplate(templateBody(custom), { pr: context(1194), appendContextFooter: false });
    expect(plain).toBe(
      "Lies den Skill $code-reviewer.\n\nReview https://github.com/acme/widgets/pull/1194.\n\nVorgehen:\n1. Diff holen.",
    );
    const fix = { id: "builtin:fix-ci", body: "Fix {{pr.url}}" };
    expect(usesStackReview(fix)).toBe(false);
    expect(templateBody(fix)).toBe(fix.body);
  });
});
