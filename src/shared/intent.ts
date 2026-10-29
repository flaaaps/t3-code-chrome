import type { PrContext, PromptTemplate } from "./models";

/**
 * Pick the primary action for a PR from its visible state: draft → summarise, failing checks →
 * fix CI, changes requested on the viewer's own PR → address comments, otherwise review.
 */
export function suggestIntent(pr: PrContext, templates: PromptTemplate[]): PromptTemplate {
  const byId = (id: string) => templates.find((t) => t.id === id);
  const own = !!pr.viewer && !!pr.author && pr.viewer.toLowerCase() === pr.author.toLowerCase();
  if (pr.checksState === "failure" && own) return byId("builtin:fix-ci") ?? fallback(templates);
  if (own && /changes requested|änderungen angefordert/i.test(pr.reviewDecision ?? "")) {
    return byId("builtin:address-review") ?? fallback(templates);
  }
  if (pr.isDraft) return byId("builtin:summarize") ?? fallback(templates);
  if (pr.checksState === "failure") return byId("builtin:fix-ci") ?? fallback(templates);
  return byId("builtin:review") ?? fallback(templates);
}

function fallback(templates: PromptTemplate[]): PromptTemplate {
  const first = templates[0];
  if (!first) throw new Error("Keine Aktionen definiert.");
  return first;
}

/** Why an intent was suggested, for the menu hint. */
export function intentReason(pr: PrContext, template: PromptTemplate): string | undefined {
  if (template.id === "builtin:fix-ci" && pr.checksState === "failure") {
    const count = pr.failedChecks?.length ?? 0;
    return count > 0 ? `${count} Check${count === 1 ? "" : "s"} rot` : "Checks rot";
  }
  if (template.id === "builtin:address-review" && /changes requested/i.test(pr.reviewDecision ?? "")) {
    return "Änderungen angefordert";
  }
  if (template.id === "builtin:summarize" && pr.isDraft) return "Draft";
  return undefined;
}
