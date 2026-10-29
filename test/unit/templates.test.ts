import { describe, expect, it } from "vitest";
import type { PrContext } from "../../src/shared/models";
import { BUILTIN_TEMPLATES } from "../../src/shared/templates/builtin";
import { defaultThreadTitle, listPlaceholders, renderTemplate } from "../../src/shared/templates/render";

const pr: PrContext = {
  host: "github.com",
  owner: "studypilot",
  repo: "monorepo",
  number: 1103,
  url: "https://github.com/studypilot/monorepo/pull/1103",
  title: "Forced logout UX",
  headBranch: "feature/logout",
  baseBranch: "main",
  author: "flaaaps",
};

describe("renderTemplate", () => {
  it("substitutes placeholders and appends the context footer", () => {
    const out = renderTemplate("Review {{pr.url}} on {{pr.headBranch}} by {{pr.author}}\n\n{{user.note}}", {
      pr,
      note: "Focus on auth.",
    });
    expect(out).toContain(
      "Review https://github.com/studypilot/monorepo/pull/1103 on feature/logout by flaaaps",
    );
    expect(out).toContain("Focus on auth.");
    expect(out).toContain(
      "Kontext: Pull Request https://github.com/studypilot/monorepo/pull/1103 · Branch `feature/logout` → `main`",
    );
  });

  it("drops unknown placeholders and collapses blank lines", () => {
    const out = renderTemplate("a{{nope}}b\n\n\n\nc", { pr, appendContextFooter: false });
    expect(out).toBe("ab\n\nc");
  });

  it("uses selection for the reply template", () => {
    const template = BUILTIN_TEMPLATES.find((t) => t.id === "builtin:reply-comment");
    expect(template).toBeDefined();
    const out = renderTemplate(template?.body ?? "", {
      pr,
      selection: "Please rename this.",
      appendContextFooter: false,
    });
    expect(out).toContain("> Please rename this.");
  });

  it("lists placeholders", () => {
    expect(listPlaceholders("{{pr.url}} {{ pr.url }} {{user.note}}")).toEqual(["pr.url", "user.note"]);
  });

  it("all builtin templates render without leftover braces", () => {
    for (const template of BUILTIN_TEMPLATES) {
      const out = renderTemplate(template.body, { pr, note: "n", selection: "s" });
      expect(out).not.toMatch(/\{\{/);
    }
  });
});

describe("defaultThreadTitle", () => {
  it("prefixes the template name and truncates", () => {
    expect(defaultThreadTitle(pr, "Review")).toBe("Review: studypilot/monorepo#1103 Forced logout UX");
    const long = defaultThreadTitle({ ...pr, title: "x".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith("…")).toBe(true);
  });
});
