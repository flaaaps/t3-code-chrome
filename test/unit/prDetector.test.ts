import { describe, expect, it } from "vitest";
import { parsePageLocation, samePage } from "../../src/content/github/prDetector";

describe("parsePageLocation", () => {
  it("tells PR pages and PR lists apart", () => {
    expect(parsePageLocation("https://github.com/a/b/pull/3")?.kind).toBe("pr");
    expect(parsePageLocation("https://github.com/a/b/pulls?q=is%3Apr")).toEqual({
      kind: "pulls",
      repo: { host: "github.com", owner: "a", repo: "b" },
    });
    expect(parsePageLocation("https://github.com/a/b/issues")).toBeUndefined();
  });
});

describe("samePage", () => {
  it("ignores filter changes on the list but not repository changes", () => {
    const list = parsePageLocation("https://github.com/a/b/pulls");
    expect(samePage(list, parsePageLocation("https://github.com/a/b/pulls?q=author%3A%40me&page=2"))).toBe(
      true,
    );
    expect(samePage(list, parsePageLocation("https://github.com/a/c/pulls"))).toBe(false);
    expect(samePage(list, parsePageLocation("https://github.com/a/b/pull/1"))).toBe(false);
  });
  it("treats another tab of the same PR as a change", () => {
    expect(
      samePage(
        parsePageLocation("https://github.com/a/b/pull/1"),
        parsePageLocation("https://github.com/a/b/pull/1/files"),
      ),
    ).toBe(false);
  });
});
