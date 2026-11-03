// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parsePullsClassicDom, readViewer } from "../../src/content/github/pullsPage";

const repo = { host: "github.acme.corp", owner: "acme", repo: "widgets" };

/** Hand-written after the classic issues list markup; not verified against a live GHES. */
const CLASSIC = `
<div class="js-navigation-container">
  <div id="issue_12" class="js-issue-row">
    <a class="js-navigation-open" data-hovercard-type="pull_request" href="/acme/widgets/pull/12">Fix login</a>
    <a class="IssueLabel">bug</a>
    <span class="opened-by">#12 opened <relative-time datetime="2026-11-02T10:00:00Z"></relative-time> by <a>jane</a></span>
  </div>
  <div id="issue_13" class="js-issue-row">
    <span aria-label="Draft Pull Request"></span>
    <a class="js-navigation-open" href="/acme/widgets/pull/13">Spike</a>
    <span class="opened-by">by <a>bob</a></span>
  </div>
</div>
<div class="pagination"><em>1</em><a>2</a><a>3</a></div>`;

describe("parsePullsClassicDom", () => {
  it("reads classic rows", () => {
    document.body.innerHTML = CLASSIC;
    const data = parsePullsClassicDom(document, repo);
    expect(data?.totalPages).toBe(3);
    expect(data?.results).toEqual([
      {
        host: "github.acme.corp",
        owner: "acme",
        repo: "widgets",
        number: 12,
        url: "https://github.acme.corp/acme/widgets/pull/12",
        title: "Fix login",
        isDraft: false,
        labels: [{ name: "bug" }],
        roles: [],
        author: "jane",
        updatedAt: "2026-11-02T10:00:00Z",
      },
      expect.objectContaining({ number: 13, isDraft: true, author: "bob" }),
    ]);
  });

  it("treats an empty classic list as no hits and unknown markup as unreadable", () => {
    document.body.innerHTML = `<div class="js-navigation-container"></div>`;
    expect(parsePullsClassicDom(document, repo)?.results).toEqual([]);
    document.body.innerHTML = `<div>something else</div>`;
    expect(parsePullsClassicDom(document, repo)).toBeUndefined();
  });
});

describe("readViewer", () => {
  it("reads the signed-in login and treats an empty tag as logged out", () => {
    document.head.innerHTML = `<meta name="user-login" content="jane">`;
    expect(readViewer()).toBe("jane");
    document.head.innerHTML = `<meta name="user-login" content="">`;
    expect(readViewer()).toBeUndefined();
    document.head.innerHTML = "";
    expect(readViewer()).toBeUndefined();
  });
});
