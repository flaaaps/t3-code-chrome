import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "../../src/background/catalog";
import { SessionTracker } from "../../src/background/sessions";
import type { Job, ThreadSummary } from "../../src/shared/models";

const jobs: Job[] = [];
vi.mock("../../src/background/storage", () => ({
  loadJobs: async () => jobs,
  saveJobs: async () => undefined,
  loadSettings: async () => ({}),
}));

const pr = (number: number) => ({ host: "github.com", owner: "acme", repo: "widgets", number });

const thread = (
  threadId: string,
  status: ThreadSummary["status"],
  prNumber?: number,
  title = threadId,
): ThreadSummary => ({
  threadId,
  envKey: "c1",
  projectId: "p1",
  title,
  status,
  link: `t3-thread://v2/env/${threadId}`,
  pullRequests:
    prNumber === undefined
      ? []
      : [
          {
            host: "github.com",
            repository: "acme/widgets",
            number: prNumber,
            url: `https://github.com/acme/widgets/pull/${prNumber}`,
          },
        ],
  settled: status === "completed",
  createdAt: "2026-11-03T08:00:00Z",
  updatedAt: "2026-11-03T09:00:00Z",
});

function catalog(threads: ThreadSummary[]) {
  const listThreads = vi.fn(async () => threads);
  const readThread = vi.fn();
  const fake = {
    listEnvironments: async () => [
      { key: "c1", connectionId: "c1", environmentId: "e1", label: "T3", linked: false, reachable: true },
      { key: "c2", connectionId: "c2", environmentId: "e2", label: "off", linked: true, reachable: false },
    ],
    listThreads,
    readThread,
  };
  return { fake: fake as unknown as Catalog, listThreads, readThread };
}

describe("SessionTracker.sessionsForPrs", () => {
  beforeEach(() => {
    jobs.length = 0;
  });

  it("matches jobs and linked threads to PRs with one listing per reachable environment", async () => {
    jobs.push({
      id: "j1",
      clientRequestId: "r1",
      pr: pr(1),
      envKey: "c1",
      threadId: "t-job",
      threadTitle: "Review",
      link: "",
      prompt: "…",
      startedAt: 0,
      updatedAt: 0,
      status: "waiting",
    });
    const { fake, listThreads, readThread } = catalog([
      thread("t-job", "waiting", 1),
      thread("t-linked", "running", 2),
      thread("t-title", "completed", undefined, "Summary acme/widgets#3"),
      thread("t-other", "running", 99),
    ]);
    const result = await new SessionTracker(fake).sessionsForPrs([pr(1), pr(2), pr(3), pr(4)]);
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(readThread).not.toHaveBeenCalled();
    expect(result["github.com/acme/widgets#1"]?.map((s) => [s.threadId, s.source])).toEqual([
      ["t-job", "job"],
    ]);
    expect(result["github.com/acme/widgets#2"]?.map((s) => [s.threadId, s.status])).toEqual([
      ["t-linked", "running"],
    ]);
    expect(result["github.com/acme/widgets#3"]?.map((s) => s.threadId)).toEqual(["t-title"]);
    expect(result["github.com/acme/widgets#4"]).toEqual([]);
  });

  it("returns an empty map for no PRs without touching T3", async () => {
    const { fake, listThreads } = catalog([]);
    expect(await new SessionTracker(fake).sessionsForPrs([])).toEqual({});
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("skips dismissed jobs", async () => {
    jobs.push({
      id: "j2",
      clientRequestId: "r2",
      pr: pr(1),
      envKey: "c1",
      threadId: "t-dismissed",
      threadTitle: "Old",
      link: "",
      prompt: "…",
      startedAt: 0,
      updatedAt: 0,
      status: "completed",
      dismissed: true,
    });
    const { fake } = catalog([]);
    expect((await new SessionTracker(fake).sessionsForPrs([pr(1)]))["github.com/acme/widgets#1"]).toEqual([]);
  });
});
