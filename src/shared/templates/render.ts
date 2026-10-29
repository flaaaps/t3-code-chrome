import type { PrContext } from "../models";

export interface RenderInput {
  pr: PrContext;
  note?: string;
  selection?: string;
  appendContextFooter?: boolean;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function templateVariables(input: RenderInput): Record<string, string> {
  const { pr } = input;
  return {
    "pr.url": pr.url,
    "pr.number": String(pr.number),
    "pr.title": pr.title,
    "pr.owner": pr.owner,
    "pr.repo": pr.repo,
    "pr.repository": `${pr.owner}/${pr.repo}`,
    "pr.headBranch": pr.headBranch ?? "(unbekannter Branch)",
    "pr.baseBranch": pr.baseBranch ?? "(unbekannter Basis-Branch)",
    "pr.author": pr.author ?? "(unbekannt)",
    "pr.state": pr.state ?? "",
    "pr.reviewDecision": pr.reviewDecision ?? "",
    selection: (input.selection ?? pr.selection ?? "").trim(),
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

export function defaultThreadTitle(
  pr: { number: number; title: string; owner: string; repo: string },
  templateName?: string,
): string {
  const prefix = templateName ? `${templateName}: ` : "";
  const title = `${prefix}${pr.owner}/${pr.repo}#${pr.number} ${pr.title}`.trim();
  return title.length > 120 ? `${title.slice(0, 117)}…` : title;
}
