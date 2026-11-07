import { describe, expect, it } from "vitest";
import type { PrContext } from "../../src/shared/models";
import { BUILTIN_TEMPLATES } from "../../src/shared/templates/builtin";
import {
  defaultThreadTitle,
  listPlaceholders,
  missingRequirements,
  renderTemplate,
} from "../../src/shared/templates/render";

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
      pr: { ...pr, comment: { text: "Please rename this.", file: "src/a.ts", line: "12", author: "jane" } },
      appendContextFooter: false,
    });
    expect(out).toContain("> Please rename this.");
    expect(out).toContain("in `src/a.ts:12` (von jane)");
  });

  it("lists placeholders", () => {
    expect(listPlaceholders("{{pr.url}} {{ pr.url }} {{user.note}}")).toEqual(["pr.url", "user.note"]);
  });

  it("all builtin templates render without leftover braces", () => {
    for (const template of BUILTIN_TEMPLATES) {
      const out = renderTemplate(template.body, { pr: { ...pr, comment: { text: "s" } }, note: "n" });
      expect(out).not.toMatch(/\{\{/);
    }
  });
});

describe("missingRequirements", () => {
  it("blocks the free prompt without text and the comment action without a comment", () => {
    const byId = (id: string) => {
      const found = BUILTIN_TEMPLATES.find((t) => t.id === id);
      if (!found) throw new Error(id);
      return found;
    };
    expect(missingRequirements(byId("builtin:free"), { note: "", comment: undefined })).toEqual(["note"]);
    expect(missingRequirements(byId("builtin:free"), { note: "do it", comment: undefined })).toEqual([]);
    expect(missingRequirements(byId("builtin:reply-comment"), { note: "", comment: undefined })).toEqual([
      "comment",
    ]);
    expect(missingRequirements(byId("builtin:reply-comment"), { note: "", comment: { text: "x" } })).toEqual(
      [],
    );
  });

  it("switches the review output text", () => {
    const review = BUILTIN_TEMPLATES.find((t) => t.id === "builtin:review");
    const inline = renderTemplate(review?.body ?? "", {
      pr,
      reviewOutput: "inline",
      appendContextFooter: false,
    });
    const report = renderTemplate(review?.body ?? "", {
      pr,
      reviewOutput: "report",
      appendContextFooter: false,
    });
    expect(inline).toContain("Inline-Review-Kommentare");
    expect(report).toContain("Poste nichts auf GitHub");
  });
});

describe("defaultThreadTitle", () => {
  const byId = (id: string) => {
    const template = BUILTIN_TEMPLATES.find((t) => t.id === id);
    if (!template) throw new Error(`missing ${id}`);
    return template;
  };

  it("puts a short action prefix before the PR title", () => {
    expect(defaultThreadTitle(pr, byId("builtin:review"))).toBe("Review: Forced logout UX");
    expect(defaultThreadTitle(pr, byId("builtin:address-review"))).toBe("Kommentare: Forced logout UX");
    expect(defaultThreadTitle(pr, byId("builtin:summarize"))).toBe("Zusammenfassung: Forced logout UX");
    expect(defaultThreadTitle(pr, byId("builtin:review"), { stack: true })).toBe(
      "Stack-Review: Forced logout UX",
    );
    // The stack only changes review actions; custom actions use their name.
    expect(defaultThreadTitle(pr, byId("builtin:fix-ci"), { stack: true })).toBe(
      "CI fixen: Forced logout UX",
    );
    expect(defaultThreadTitle(pr, { id: "custom:x", name: "Sicherheitscheck" })).toBe(
      "Sicherheitscheck: Forced logout UX",
    );
    expect(defaultThreadTitle(pr)).toBe("Forced logout UX");
  });

  it("falls back to the PR number and truncates", () => {
    expect(defaultThreadTitle({ ...pr, title: "  " }, byId("builtin:review"))).toBe(
      "Review: Pull Request #1103",
    );
    const long = defaultThreadTitle({ ...pr, title: "x".repeat(200) }, byId("builtin:review"));
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });
});
