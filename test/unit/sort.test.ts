import { describe, expect, it } from "vitest";
import type { Project, ThreadSummary } from "../../src/shared/models";
import { matchProject, rankThreads } from "../../src/shared/sort";

const pr = { host: "github.com", owner: "studypilot", repo: "monorepo", number: 1103 };

function project(partial: Partial<Project> & Pick<Project, "id" | "title">): Project {
  return { envKey: "c1", workspaceRoot: "/x", updatedAt: "2026-01-01T00:00:00Z", ...partial };
}

function thread(
  partial: Partial<ThreadSummary> & Pick<ThreadSummary, "threadId" | "projectId">,
): ThreadSummary {
  return {
    envKey: "c1",
    title: partial.threadId,
    status: "completed",
    link: `t3-thread://v2/env/${partial.threadId}`,
    pullRequests: [],
    settled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("matchProject", () => {
  it("matches by canonical key, then display name, then title", () => {
    const projects = [
      project({ id: "p1", title: "other", canonicalKey: "github.com/foo/bar" }),
      project({ id: "p2", title: "mono", canonicalKey: "github.com/studypilot/monorepo" }),
    ];
    expect(matchProject(projects, pr)?.id).toBe("p2");
    expect(
      matchProject([project({ id: "p3", title: "x", repoDisplayName: "StudyPilot/Monorepo" })], pr)?.id,
    ).toBe("p3");
    expect(matchProject([project({ id: "p4", title: "monorepo" })], pr)?.id).toBe("p4");
    expect(matchProject([project({ id: "p5", title: "nope" })], pr)).toBeUndefined();
  });
});

describe("rankThreads", () => {
  it("puts threads linked to the PR first, then active project threads, then the rest", () => {
    const threads = [
      thread({ threadId: "other-project", projectId: "p9", updatedAt: "2026-03-01T00:00:00Z" }),
      thread({ threadId: "same-project-old", projectId: "p2", updatedAt: "2026-01-05T00:00:00Z" }),
      thread({
        threadId: "same-project-running",
        projectId: "p2",
        status: "running",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
      thread({
        threadId: "linked",
        projectId: "p2",
        updatedAt: "2025-12-01T00:00:00Z",
        pullRequests: [
          {
            host: "github.com",
            repository: "studypilot/monorepo",
            number: 1103,
            url: "https://github.com/studypilot/monorepo/pull/1103",
          },
        ],
      }),
      thread({
        threadId: "title-mention",
        projectId: "p9",
        title: "Fix review on studypilot/monorepo#1103",
        updatedAt: "2025-11-01T00:00:00Z",
      }),
      thread({ threadId: "same-project-newer", projectId: "p2", updatedAt: "2026-02-01T00:00:00Z" }),
    ];
    const ranked = rankThreads(threads, pr, "p2").map((r) => `${r.group}:${r.thread.threadId}`);
    expect(ranked).toEqual([
      "this-pr:linked",
      "this-pr:title-mention",
      "project-active:same-project-running",
      "project:same-project-newer",
      "project:same-project-old",
      "other:other-project",
    ]);
  });

  it("does not treat other PR numbers of the same repo as linked", () => {
    const threads = [
      thread({
        threadId: "other-pr",
        projectId: "p2",
        pullRequests: [
          {
            host: "github.com",
            repository: "studypilot/monorepo",
            number: 1104,
            url: "https://github.com/studypilot/monorepo/pull/1104",
          },
        ],
      }),
    ];
    expect(rankThreads(threads, pr, "p2")[0]?.group).toBe("project");
  });
});
