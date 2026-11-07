import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Session } from "../../src/shared/models";
import { prKeyToString } from "../../src/shared/prKey";
import {
  assignPanels,
  extractEmbeddedData,
  groupStacks,
  type PrListItem,
  type PrPageFacts,
  type PullsPageData,
  parseHovercardRefs,
  parsePrPageEmbedded,
  parsePullsEmbedded,
  primaryActionFor,
  prListItemToContext,
  sortPanelEntries,
} from "../../src/shared/pulls";
import { BUILTIN_TEMPLATES } from "../../src/shared/templates/builtin";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const repo = { host: "github.com", owner: "preactjs", repo: "preact" };

const item = (number: number, extra: Partial<PrListItem> = {}): PrListItem => ({
  host: "github.com",
  owner: "acme",
  repo: "widgets",
  number,
  url: `https://github.com/acme/widgets/pull/${number}`,
  title: `PR ${number}`,
  isDraft: false,
  labels: [],
  roles: [],
  ...extra,
});

const page = (items: PrListItem[], totalCount = items.length): PullsPageData => ({
  results: items,
  currentPage: 1,
  totalPages: 1,
  totalCount,
});

const session = (pr: PrListItem, status: Session["status"], threadId = `t-${pr.number}`): Session => ({
  key: `thread:${threadId}`,
  envKey: "c1",
  threadId,
  pr: { host: pr.host, owner: pr.owner, repo: pr.repo, number: pr.number },
  title: `Session ${threadId}`,
  status,
  link: "",
  updatedAt: "2026-11-03T10:00:00Z",
  source: "linked",
});

describe("parsePullsEmbedded", () => {
  it("reads the list from GitHub's server-rendered page", () => {
    const data = parsePullsEmbedded(fixture("pulls-react.html"), repo);
    expect(data?.totalPages).toBe(2);
    expect(data?.totalCount).toBe(27);
    expect(data?.results.map((r) => r.number)).toEqual([5348, 2329, 3377]);
    const [first, labelled, draft] = data?.results ?? [];
    expect(first).toMatchObject({
      host: "github.com",
      owner: "preactjs",
      repo: "preact",
      url: "https://github.com/preactjs/preact/pull/5348",
      author: "jonkwheeler",
      isDraft: false,
      commentCount: 1,
      updatedAt: "2026-11-03T18:00:22Z",
    });
    expect(labelled?.labels).toEqual([{ name: "types", color: "fef2c0" }]);
    expect(draft?.isDraft).toBe(true);
  });

  it("returns undefined without a list payload and an empty list for no hits", () => {
    expect(parsePullsEmbedded("<html><body>nope</body></html>", repo)).toBeUndefined();
    const empty = `<script type="application/json" data-target="react-app.embeddedData">{"payload":{"r":{"results":[],"currentPage":1,"openCount":0}}}</script>`;
    expect(parsePullsEmbedded(empty, repo)).toEqual({
      results: [],
      currentPage: 1,
      totalPages: 1,
      totalCount: 0,
    });
  });

  it("reads a search without hits, where GitHub omits results and totalCount", () => {
    // Shape of github.com/preactjs/preact/pulls?q=is:pr+state:open+label:bug on 2026-11-03.
    const html = `<script type="application/json" data-target="react-app.embeddedData">{"payload":{"repoPullsDashboardContentRoute":{"currentPage":1,"openCount":0,"closedCount":4},"repoLayoutRoute":{}}}</script>`;
    expect(parsePullsEmbedded(html, repo)).toEqual({
      results: [],
      currentPage: 1,
      totalPages: 1,
      totalCount: 0,
    });
  });

  it("skips broken payloads and entries without number or title", () => {
    const html = `<script data-target="react-app.embeddedData" type="application/json">{broken</script>
      <script type="application/json" data-target="react-app.embeddedData">{"payload":{"x":{"currentPage":1,"results":[{"number":3},{"number":4,"title":"ok","state":"REPO_PULL_REQUEST_STATE_OPEN"}]}}}</script>`;
    expect(extractEmbeddedData(html)).toHaveLength(1);
    expect(parsePullsEmbedded(html, repo)?.results.map((r) => r.number)).toEqual([4]);
  });

  it("reads a PR's place in a native stack (fields as on github.com, November 2026)", () => {
    const entry = (number: number, stackPosition: number | null, stackSize: number | null) =>
      JSON.stringify({
        number,
        title: `PR ${number}`,
        state: "REPO_PULL_REQUEST_STATE_OPEN",
        stackPosition,
        stackSize,
      });
    const html = `<script type="application/json" data-target="react-app.embeddedData">{"payload":{"repoPullsDashboardContentRoute":{"currentPage":1,"totalPages":1,"results":[${entry(1194, 2, 2)},${entry(1195, null, null)}]}}}</script>`;
    const [stacked, single] = parsePullsEmbedded(html, repo)?.results ?? [];
    expect(stacked?.stack).toEqual({ position: 2, size: 2 });
    expect(single?.stack).toBeUndefined();
  });
});

describe("parsePrPageEmbedded", () => {
  it("reads branches and author from the PR page", () => {
    expect(parsePrPageEmbedded(fixture("pr-page.html"), 5348)).toEqual({
      headBranch: "fix/throw-null-then-v10",
      headOwner: "jonkwheeler",
      baseBranch: "v10.x",
      author: "jonkwheeler",
      title: "Pass a thrown null or undefined to error boundaries (v10.x)",
    });
  });
  it("ignores other PRs", () => {
    expect(parsePrPageEmbedded(fixture("pr-page.html"), 1)).toBeUndefined();
  });
});

describe("assignPanels", () => {
  it("merges authored and assigned PRs and keeps review requests apart", () => {
    const result = assignPanels({
      author: page([item(1), item(2)]),
      assignee: page([item(2), item(3)]),
      "review-requested": page([item(3), item(4)], 7),
    });
    expect(result.mine.map((i) => [i.number, i.roles])).toEqual([
      [1, ["author"]],
      [2, ["author", "assignee"]],
      [3, ["assignee", "review-requested"]],
    ]);
    expect(result.review.map((i) => i.number)).toEqual([4]);
    expect(result.totals).toEqual({ review: 7, mine: 3 });
  });

  it("does not mutate the input pages", () => {
    const authored = page([item(1)]);
    assignPanels({ author: authored, assignee: page([item(1)]), "review-requested": page([]) });
    expect(authored.results[0]?.roles).toEqual([]);
  });
});

describe("parseHovercardRefs", () => {
  it("reads base and head branch from a real PR hovercard", () => {
    expect(parseHovercardRefs(fixture("pr-hovercard.html"))).toEqual({
      baseBranch: "v10.x",
      headBranch: "fix/throw-null-then-v10",
      headOwner: "jonkwheeler",
    });
  });
  it("returns undefined for other markup", () => {
    expect(parseHovercardRefs("<div>Not found</div>")).toBeUndefined();
  });
});

const facts = (base: string, head: string, headOwner = "acme"): PrPageFacts => ({
  baseBranch: base,
  headBranch: head,
  headOwner,
});

describe("groupStacks", () => {
  const key = (n: number) => prKeyToString(item(n));

  it("groups PRs that merge into each other's branches, parent before child", () => {
    const branches = {
      [key(10)]: facts("main", "feat/a"),
      [key(11)]: facts("feat/a", "feat/b"),
      [key(12)]: facts("feat/b", "feat/c"),
      [key(13)]: facts("main", "fix/x"),
    };
    const entries = groupStacks([item(12), item(13), item(10), item(11)], branches);
    expect(
      entries.map((e) => [e.root.number, e.stacked.map((s) => [s.item.number, s.depth, s.parent])]),
    ).toEqual([
      [13, []],
      [
        10,
        [
          [11, 1, 10],
          [12, 2, 11],
        ],
      ],
    ]);
  });

  it("does not stack on a fork's branch of the same name", () => {
    const branches = {
      [key(1)]: facts("main", "feat/a", "someone-else"),
      [key(2)]: facts("feat/a", "feat/b"),
    };
    expect(groupStacks([item(1), item(2)], branches).map((e) => e.stacked.length)).toEqual([0, 0]);
  });

  it("keeps rows without branch data and survives cycles", () => {
    const branches = {
      [key(1)]: facts("feat/b", "feat/a"),
      [key(2)]: facts("feat/a", "feat/b"),
    };
    const entries = groupStacks([item(1), item(2), item(3)], branches);
    const shown = entries.flatMap((e) => [e.root.number, ...e.stacked.map((s) => s.item.number)]);
    expect(shown.sort()).toEqual([1, 2, 3]);
  });
});

describe("sortPanelEntries", () => {
  it("puts waiting, then running sessions first, then newest activity", () => {
    const a = item(1, { updatedAt: "2026-11-01T00:00:00Z" });
    const b = item(2, { updatedAt: "2026-11-03T00:00:00Z" });
    const c = item(3, { updatedAt: "2026-10-01T00:00:00Z" });
    const d = item(4, { updatedAt: "2026-09-01T00:00:00Z" });
    const sessions = {
      [prKeyToString(c)]: [session(c, "running")],
      [prKeyToString(d)]: [session(d, "completed"), session(d, "waiting", "t-d2")],
    };
    const entries = [a, b, c, d].map((root) => ({ root, stacked: [] }));
    expect(sortPanelEntries(entries, sessions).map((e) => e.root.number)).toEqual([4, 3, 2, 1]);
  });

  it("ranks a stack by its most urgent PR", () => {
    const root = item(1, { updatedAt: "2026-01-01T00:00:00Z" });
    const top = item(2, { updatedAt: "2026-01-02T00:00:00Z" });
    const single = item(3, { updatedAt: "2026-11-03T00:00:00Z" });
    const entries = [
      { root: single, stacked: [] },
      { root, stacked: [{ item: top, depth: 1, parent: 1 }] },
    ];
    const sessions = { [prKeyToString(top)]: [session(top, "waiting")] };
    expect(sortPanelEntries(entries, sessions).map((e) => e.root.number)).toEqual([1, 3]);
  });
});

describe("primaryActionFor", () => {
  it("opens a waiting or running session", () => {
    const pr = item(1);
    expect(primaryActionFor(pr, "review", [session(pr, "waiting")], BUILTIN_TEMPLATES, "me")).toMatchObject({
      kind: "open",
      label: "Antworten",
    });
    expect(primaryActionFor(pr, "mine", [session(pr, "running")], BUILTIN_TEMPLATES, "me")).toMatchObject({
      kind: "open",
      label: "Session öffnen",
    });
  });

  it("summarises own PRs and reviews requested ones when nothing else is known", () => {
    const pr = item(1, { author: "me" });
    const done = [session(pr, "completed")];
    const mine = primaryActionFor(pr, "mine", done, BUILTIN_TEMPLATES, "me");
    const review = primaryActionFor(item(2, { author: "jane" }), "review", [], BUILTIN_TEMPLATES, "me");
    expect(mine.kind === "intent" && mine.template.id).toBe("builtin:summarize");
    expect(review.kind === "intent" && review.template.id).toBe("builtin:review");
  });

  it("summarises drafts in the review panel too", () => {
    const action = primaryActionFor(item(2, { isDraft: true }), "review", [], BUILTIN_TEMPLATES, "me");
    expect(action.kind === "intent" && action.template.id).toBe("builtin:summarize");
  });
});

describe("prListItemToContext", () => {
  it("combines list data with branch facts", () => {
    const context = prListItemToContext(item(5, { author: "jane", isDraft: true }), "me", {
      headBranch: "feat/x",
      baseBranch: "main",
    });
    expect(context).toMatchObject({
      number: 5,
      url: "https://github.com/acme/widgets/pull/5",
      author: "jane",
      viewer: "me",
      isDraft: true,
      state: "draft",
      headBranch: "feat/x",
      baseBranch: "main",
      checksState: "unknown",
    });
  });
});
