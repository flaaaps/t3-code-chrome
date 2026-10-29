import { describe, expect, it } from "vitest";
import { normaliseRepoIdentifier, parsePrUrl, prKeyEquals, repoCanonicalKey } from "../../src/shared/prKey";

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
