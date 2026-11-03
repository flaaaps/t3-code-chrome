import { describe, expect, it } from "vitest";
import {
  githubMatchPatterns,
  isGitHubHost,
  normaliseEnterpriseHost,
  normaliseRepoIdentifier,
  parsePrUrl,
  parsePullsUrl,
  prKeyEquals,
  pullsPath,
  repoCanonicalKey,
} from "../../src/shared/prKey";

describe("parsePrUrl", () => {
  it("parses conversation, files, commits and checks tabs", () => {
    expect(parsePrUrl("https://github.com/studypilot/monorepo/pull/1103")).toEqual({
      host: "github.com",
      owner: "studypilot",
      repo: "monorepo",
      number: 1103,
      tab: "conversation",
    });
    expect(parsePrUrl("https://github.com/a/b/pull/7/files?diff=split#r1")?.tab).toBe("files");
    expect(parsePrUrl("https://github.com/a/b/pull/7/commits/abc")?.tab).toBe("commits");
    expect(parsePrUrl("https://github.com/a/b/pull/7/checks")?.tab).toBe("checks");
  });

  it("rejects non-PR pages", () => {
    expect(parsePrUrl("https://github.com/a/b/pulls")).toBeUndefined();
    expect(parsePrUrl("https://github.com/a/b/issues/3")).toBeUndefined();
    expect(parsePrUrl("https://gitlab.com/a/b/pull/3")).toBeUndefined();
    expect(parsePrUrl("https://github.com/a/b/pull/abc")).toBeUndefined();
  });

  it("compares keys case-insensitively", () => {
    const a = parsePrUrl("https://github.com/Foo/Bar/pull/1");
    const b = parsePrUrl("https://github.com/foo/bar/pull/1");
    expect(prKeyEquals(a, b)).toBe(true);
    expect(prKeyEquals(a, parsePrUrl("https://github.com/foo/bar/pull/2"))).toBe(false);
  });
});

describe("GitHub Enterprise", () => {
  it("parses *.ghe.com PRs and keeps the tenant host", () => {
    expect(parsePrUrl("https://octocorp.ghe.com/team/api/pull/12/files")).toEqual({
      host: "octocorp.ghe.com",
      owner: "team",
      repo: "api",
      number: 12,
      tab: "files",
    });
  });

  it("accepts Enterprise Server hosts only when configured", () => {
    const url = "https://github.acme.corp/platform/web/pull/3";
    expect(parsePrUrl(url)).toBeUndefined();
    expect(parsePrUrl(url, ["github.acme.corp"])?.host).toBe("github.acme.corp");
    expect(parsePrUrl(url, "any")?.number).toBe(3);
    expect(parsePrUrl("https://www.github.com/a/b/pull/1")?.host).toBe("github.com");
  });

  it("recognises GitHub hosts", () => {
    expect(isGitHubHost("github.com")).toBe(true);
    expect(isGitHubHost("Octocorp.GHE.com")).toBe(true);
    expect(isGitHubHost("evil.com.ghe.com.example")).toBe(false);
    expect(isGitHubHost("a.b.ghe.com")).toBe(false);
    expect(isGitHubHost("github.acme.corp", ["github.acme.corp"])).toBe(true);
  });

  it("normalises host input and builds match patterns", () => {
    expect(normaliseEnterpriseHost(" https://GitHub.Acme.corp/org/repo ")).toBe("github.acme.corp");
    expect(normaliseEnterpriseHost("github.acme.corp")).toBe("github.acme.corp");
    expect(normaliseEnterpriseHost("localhost")).toBeUndefined();
    expect(normaliseEnterpriseHost("")).toBeUndefined();
    expect(githubMatchPatterns(["github.acme.corp", "x.ghe.com"])).toEqual([
      "https://github.com/*",
      "https://*.ghe.com/*",
      "https://github.acme.corp/*",
    ]);
  });

  it("canonical keys keep the enterprise host", () => {
    expect(normaliseRepoIdentifier("git@github.acme.corp:Platform/Web.git")).toBe(
      "github.acme.corp/platform/web",
    );
    expect(repoCanonicalKey({ host: "github.acme.corp", owner: "Platform", repo: "Web" })).toBe(
      "github.acme.corp/platform/web",
    );
  });
});

describe("repository identifiers", () => {
  it("normalises remote urls and canonical keys", () => {
    expect(normaliseRepoIdentifier("github.com/studypilot/monorepo")).toBe("github.com/studypilot/monorepo");
    expect(normaliseRepoIdentifier("https://github.com/studypilot/monorepo.git")).toBe(
      "github.com/studypilot/monorepo",
    );
    expect(normaliseRepoIdentifier("git@github.com:StudyPilot/Monorepo.git")).toBe(
      "github.com/studypilot/monorepo",
    );
    expect(normaliseRepoIdentifier("ssh://git@github.com/a/b")).toBe("github.com/a/b");
    expect(normaliseRepoIdentifier("")).toBeUndefined();
    expect(normaliseRepoIdentifier("nonsense")).toBeUndefined();
  });

  it("builds the canonical key for a PR", () => {
    expect(repoCanonicalKey({ host: "github.com", owner: "A", repo: "B" })).toBe("github.com/a/b");
  });
});

describe("parsePullsUrl", () => {
  it("parses the PR list with and without filters", () => {
    const expected = { host: "github.com", owner: "a", repo: "b" };
    expect(parsePullsUrl("https://github.com/a/b/pulls")).toEqual(expected);
    expect(parsePullsUrl("https://www.github.com/a/b/pulls/")).toEqual(expected);
    expect(parsePullsUrl("https://github.com/a/b/pulls?q=is%3Apr+author%3A%40me&page=2")).toEqual(expected);
  });
  it("rejects sub-pages, other pages and foreign hosts", () => {
    expect(parsePullsUrl("https://github.com/a/b/pulls/123")).toBeUndefined();
    expect(parsePullsUrl("https://github.com/a/b/pull/123")).toBeUndefined();
    expect(parsePullsUrl("https://github.com/a/b/issues")).toBeUndefined();
    expect(parsePullsUrl("https://github.com/pulls")).toBeUndefined();
    expect(parsePullsUrl("https://gitlab.com/a/b/pulls")).toBeUndefined();
  });
  it("accepts enterprise hosts when listed or when hosts are not checked", () => {
    expect(parsePullsUrl("https://git.acme.corp/a/b/pulls", ["git.acme.corp"])?.host).toBe("git.acme.corp");
    expect(parsePullsUrl("https://git.acme.corp/a/b/pulls", "any")?.host).toBe("git.acme.corp");
    expect(parsePullsUrl("https://git.acme.corp/a/b/pulls")).toBeUndefined();
  });
});

describe("pullsPath", () => {
  it("encodes the search query like GitHub does", () => {
    expect(pullsPath({ host: "github.com", owner: "a", repo: "b" })).toBe("/a/b/pulls");
    expect(pullsPath({ host: "github.com", owner: "a", repo: "b" }, "is:pr state:open author:@me")).toBe(
      "/a/b/pulls?q=is%3Apr+state%3Aopen+author%3A%40me",
    );
  });
});
