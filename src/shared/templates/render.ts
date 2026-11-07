import type { PrContext, PromptTemplate, ReviewOutput } from "../models";
import { stackReviewEntries } from "../stack";
import { REVIEW_OUTPUT_TEXT } from "./builtin";

export interface RenderInput {
  pr: PrContext;
  note?: string;
  reviewOutput?: ReviewOutput;
  /** Review every open PR of the PR's stack (`{{review.stack}}`); default true. */
  reviewStack?: boolean;
  appendContextFooter?: boolean;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export const PLACEHOLDERS: Array<{ name: string; hint: string }> = [
  { name: "pr.url", hint: "URL des Pull Requests" },
  { name: "pr.number", hint: "Nummer" },
  { name: "pr.title", hint: "Titel" },
  { name: "pr.description", hint: "Beschreibung (gekürzt)" },
  { name: "pr.owner", hint: "Owner" },
  { name: "pr.repo", hint: "Repository-Name" },
  { name: "pr.repository", hint: "owner/repo" },
  { name: "pr.headBranch", hint: "Head-Branch" },
  { name: "pr.baseBranch", hint: "Base-Branch" },
  { name: "pr.author", hint: "Autor" },
  { name: "pr.failedChecks", hint: "Fehlgeschlagene Checks" },
  { name: "comment.text", hint: "Kommentartext" },
  { name: "comment.file", hint: "Datei des Kommentars" },
  { name: "comment.line", hint: "Zeile des Kommentars" },
  { name: "comment.url", hint: "Link zum Kommentar" },
  { name: "comment.location", hint: "„ in <Datei>:<Zeile> (<Autor>)“" },
  { name: "review.output", hint: "Inline-Kommentare oder nur Bericht" },
  { name: "review.stack", hint: "Auftrag, den ganzen Stack zu reviewen (leer ohne Stack)" },
  { name: "user.note", hint: "Dein Text" },
];

export function templateVariables(input: RenderInput): Record<string, string> {
  const { pr } = input;
  const comment = pr.comment;
  const locationParts: string[] = [];
  if (comment?.file) locationParts.push(` in \`${comment.file}${comment.line ? `:${comment.line}` : ""}\``);
  if (comment?.author) locationParts.push(` (von ${comment.author})`);
  if (comment?.url) locationParts.push(`, ${comment.url}`);
  const failed = pr.failedChecks?.length ? ` (${pr.failedChecks.join(", ")})` : "";
  return {
    "pr.url": pr.url,
    "pr.number": String(pr.number),
    "pr.title": pr.title,
    "pr.description": (pr.description ?? "").slice(0, 1500),
    "pr.owner": pr.owner,
    "pr.repo": pr.repo,
    "pr.repository": `${pr.owner}/${pr.repo}`,
    "pr.headBranch": pr.headBranch ?? "(unbekannter Branch)",
    "pr.baseBranch": pr.baseBranch ?? "(unbekannter Basis-Branch)",
    "pr.author": pr.author ?? "(unbekannt)",
    "pr.state": pr.state ?? "",
    "pr.reviewDecision": pr.reviewDecision ?? "",
    "pr.failedChecks": failed,
    "comment.text": (comment?.text ?? "").trim(),
    "comment.file": comment?.file ?? "",
    "comment.line": comment?.line ?? "",
    "comment.url": comment?.url ?? "",
    "comment.author": comment?.author ?? "",
    "comment.location": locationParts.join(""),
    "review.output": REVIEW_OUTPUT_TEXT[input.reviewOutput ?? "inline"],
    "review.stack": input.reviewStack === false ? "" : stackReviewText(pr),
    "user.note": (input.note ?? "").trim(),
  };
}

/** The stack paragraph of a review prompt; empty when the PR is not in a stack with other open PRs. */
export function stackReviewText(pr: PrContext): string {
  const entries = stackReviewEntries(pr);
  if (!entries) return "";
  const lines = entries.map((entry, index) => {
    const branches = entry.headBranch
      ? ` (\`${entry.headBranch}\`${entry.baseBranch ? ` → \`${entry.baseBranch}\`` : ""})`
      : "";
    const marker = entry.current ? " ← diese Seite" : "";
    return `${index + 1}. #${entry.number} „${entry.title}“${branches}, ${entry.url}${marker}`;
  });
  return [
    `Der Pull Request ist Teil eines Stacks. Reviewe den ganzen Stack, nicht nur #${pr.number}. Offene Pull Requests im Stack, von unten nach oben:`,
    lines.join("\n"),
    "Für den Stack gilt:",
    "- Verknüpfe den Thread mit allen Pull Requests des Stacks (`link_pull_requests`).",
    "- Prüfe jeden Pull Request gegen den darunter (`gh pr diff <Nummer>`), damit jede Änderung genau bei dem Pull Request landet, der sie einführt. Achte zusätzlich darauf, dass die Pull Requests zusammenpassen und jeder für sich mergebar bleibt.",
    "- Ordne jedes Finding dem Pull Request zu, der die Änderung einführt, und gib die Merge-Empfehlung pro Pull Request.",
  ].join("\n");
}

export function renderTemplate(body: string, input: RenderInput): string {
  const vars = templateVariables(input);
  let text = body.replace(PLACEHOLDER, (_match, name: string) => vars[name] ?? "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (input.appendContextFooter !== false) {
    text += `\n\n---\nKontext: Pull Request ${input.pr.url}`;
    if (input.pr.headBranch) text += ` · Branch \`${input.pr.headBranch}\``;
    if (input.pr.baseBranch) text += ` → \`${input.pr.baseBranch}\``;
  }
  return text;
}

export function listPlaceholders(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

type StackTemplate = Pick<PromptTemplate, "id" | "body" | "reviewOutput">;

const isReview = (template: Pick<PromptTemplate, "id" | "reviewOutput">) =>
  template.reviewOutput === true || template.id === "builtin:review";

/** Whether a template offers the whole-stack review: it uses `{{review.stack}}` or is a review action. */
export function usesStackReview(template: StackTemplate): boolean {
  return listPlaceholders(template.body).includes("review.stack") || isReview(template);
}

/**
 * The body to render. A review action without `{{review.stack}}` (customised before the placeholder
 * existed) gets it before its "Vorgehen:" steps, else at the end; empty when the PR has no stack.
 */
export function templateBody(template: StackTemplate): string {
  const { body } = template;
  if (!isReview(template) || listPlaceholders(body).includes("review.stack")) return body;
  const steps = body.search(/\n\s*\nVorgehen:/);
  if (steps >= 0) return `${body.slice(0, steps)}\n\n{{review.stack}}${body.slice(steps)}`;
  return `${body}\n\n{{review.stack}}`;
}

/** Which required inputs of a template are still missing. */
export function missingRequirements(
  template: PromptTemplate,
  input: { note?: string; comment?: { text: string } | undefined },
): Array<"note" | "comment"> {
  const missing: Array<"note" | "comment"> = [];
  for (const requirement of template.requires ?? []) {
    if (requirement === "note" && !(input.note ?? "").trim()) missing.push("note");
    if (requirement === "comment" && !(input.comment?.text ?? "").trim()) missing.push("comment");
  }
  return missing;
}

/** Short thread-title prefixes of the built-in actions; other actions use their name. */
const TITLE_PREFIXES: Record<string, string> = {
  "builtin:review": "Review",
  "builtin:address-review": "Kommentare",
  "builtin:fix-ci": "CI fixen",
  "builtin:reply-comment": "Kommentar",
  "builtin:summarize": "Zusammenfassung",
  "builtin:free": "Aufgabe",
};

/** The prefix a new thread's title gets for an action ("Review", "Stack-Review", "Kommentare"…). */
export function threadTitlePrefix(
  template: Pick<PromptTemplate, "id" | "name" | "reviewOutput">,
  options: { stack?: boolean } = {},
): string {
  if (options.stack && isReview(template)) return "Stack-Review";
  return TITLE_PREFIXES[template.id] ?? template.name;
}

/** "<prefix>: <PR title>", e.g. "Review: Forced logout UX"; at most 120 characters. */
export function defaultThreadTitle(
  pr: { number: number; title: string },
  template?: Pick<PromptTemplate, "id" | "name" | "reviewOutput">,
  options: { stack?: boolean } = {},
): string {
  const name = pr.title.replace(/\s+/g, " ").trim() || `Pull Request #${pr.number}`;
  const title = template ? `${threadTitlePrefix(template, options)}: ${name}` : name;
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}

export const SAMPLE_PR: PrContext = {
  host: "github.com",
  owner: "acme",
  repo: "widgets",
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  title: "feat(api): Rate-Limit für Exporte",
  description: "Fügt ein Token-Bucket-Rate-Limit für den Export-Endpunkt hinzu.",
  headBranch: "feat/export-rate-limit",
  baseBranch: "main",
  author: "jane",
  failedChecks: ["ci / test (node 22)"],
  comment: {
    author: "jane",
    file: "src/api/export.ts",
    line: "88",
    url: "https://github.com/acme/widgets/pull/42#discussion_r1",
    text: "Bitte den Bucket pro Mandant statt global führen.",
  },
};
