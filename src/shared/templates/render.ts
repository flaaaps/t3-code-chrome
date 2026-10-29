import type { PrContext, PromptTemplate, ReviewOutput } from "../models";
import { REVIEW_OUTPUT_TEXT } from "./builtin";

export interface RenderInput {
  pr: PrContext;
  note?: string;
  reviewOutput?: ReviewOutput;
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
    "user.note": (input.note ?? "").trim(),
  };
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

export function defaultThreadTitle(
  pr: { number: number; title: string; owner: string; repo: string },
  templateName?: string,
): string {
  const prefix = templateName ? `${templateName}: ` : "";
  const title = `${prefix}${pr.owner}/${pr.repo}#${pr.number} ${pr.title}`.trim();
  return title.length > 120 ? `${title.slice(0, 117)}…` : title;
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
