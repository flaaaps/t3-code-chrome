import { describe, expect, it } from "vitest";
import { intentReason, suggestIntent } from "../../src/shared/intent";
import type { PrContext } from "../../src/shared/models";
import { BUILTIN_TEMPLATES } from "../../src/shared/templates/builtin";

const base: PrContext = {
  host: "github.com",
  owner: "acme",
  repo: "widgets",
  number: 1,
  url: "https://github.com/acme/widgets/pull/1",
  title: "x",
  author: "jane",
  viewer: "bob",
};

describe("suggestIntent", () => {
  it("defaults to review", () => {
    expect(suggestIntent(base, BUILTIN_TEMPLATES).id).toBe("builtin:review");
  });
  it("prefers fixing CI on the viewer's own PR with failing checks", () => {
    const pr = { ...base, viewer: "jane", checksState: "failure" as const, failedChecks: ["ci"] };
    const intent = suggestIntent(pr, BUILTIN_TEMPLATES);
    expect(intent.id).toBe("builtin:fix-ci");
    expect(intentReason(pr, intent)).toBe("1 Check rot");
  });
  it("addresses review comments when changes were requested on own PR", () => {
    expect(
      suggestIntent({ ...base, viewer: "jane", reviewDecision: "Changes requested" }, BUILTIN_TEMPLATES).id,
    ).toBe("builtin:address-review");
  });
  it("summarises drafts", () => {
    expect(suggestIntent({ ...base, isDraft: true }, BUILTIN_TEMPLATES).id).toBe("builtin:summarize");
  });
  it("still suggests fixing CI for someone else's failing PR", () => {
    expect(suggestIntent({ ...base, checksState: "failure" }, BUILTIN_TEMPLATES).id).toBe("builtin:fix-ci");
  });
});
