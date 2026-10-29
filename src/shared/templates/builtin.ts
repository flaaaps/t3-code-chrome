import type { PromptTemplate } from "../models";

/**
 * Every action starts by binding the thread to the PR so T3 tracks it, and by honouring a stored
 * review guide. `{{review.output}}` is filled from the "Inline-Kommentare / Nur Bericht" switch.
 */
const PREAMBLE = `Verknüpfe diesen Thread zuerst mit dem Pull Request {{pr.url}} (\`link_pull_request\`) und lies den gespeicherten Review-Guide, falls es einen gibt (\`read_pull_request_guide\`).`;

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: "builtin:review",
    name: "Review durchführen",
    actionLabel: "Review starten",
    description: "Gründliches Code-Review des Pull Requests.",
    builtin: true,
    defaultTarget: "new",
    preferWorktree: true,
    reviewOutput: true,
    body: `${PREAMBLE}

Führe dann ein gründliches Code-Review für den Pull Request {{pr.url}} durch („{{pr.title}}“, Branch {{pr.headBranch}} → {{pr.baseBranch}}).

Vorgehen:
1. Hole Diff, Beschreibung, bestehende Review-Kommentare und den Status der Checks (z. B. \`gh pr view\`, \`gh pr diff\`, \`gh api\`).
2. Prüfe Korrektheit, Randfälle, Sicherheit, Performance und Testabdeckung. Verifiziere Behauptungen im Code, nicht nur im Diff.
3. {{review.output}}
4. Schließe mit einer Merge-Empfehlung (approve / request changes) und kurzer Begründung.

{{user.note}}`,
  },
  {
    id: "builtin:address-review",
    name: "Review-Kommentare abarbeiten",
    actionLabel: "Kommentare abarbeiten",
    description: "Offene Review-Threads umsetzen oder beantworten, pushen, Threads auflösen.",
    builtin: true,
    defaultTarget: "existing",
    defaultSendMode: "queue",
    preferWorktree: true,
    body: `${PREAMBLE}

Arbeite die offenen Review-Kommentare des Pull Requests {{pr.url}} ab (Branch {{pr.headBranch}}).

Vorgehen:
1. Lies alle offenen (nicht aufgelösten) Review-Threads und allgemeinen Kommentare.
2. Setze berechtigte Änderungswünsche im Code um. Wo du anderer Meinung bist, antworte sachlich im jeweiligen Thread statt zu ändern.
3. Führe die relevanten Tests und Linter aus.
4. Committe mit aussagekräftiger Nachricht, pushe auf {{pr.headBranch}} und antworte in jedem bearbeiteten Thread kurz, was geändert wurde. Löse erledigte Threads auf.
5. Melde am Ende, welche Punkte umgesetzt wurden und welche offen bleiben und warum.

{{user.note}}`,
  },
  {
    id: "builtin:fix-ci",
    name: "CI-Fehler beheben",
    actionLabel: "CI fixen",
    description: "Fehlgeschlagene Checks analysieren und beheben.",
    builtin: true,
    defaultTarget: "new",
    preferWorktree: true,
    body: `${PREAMBLE}

Die Checks des Pull Requests {{pr.url}} (Branch {{pr.headBranch}}) schlagen fehl{{pr.failedChecks}}.

Vorgehen:
1. Ermittle die fehlgeschlagenen Checks und ihre Logs (\`gh pr checks\`, \`gh run view --log-failed\`).
2. Reproduziere das Problem lokal, wo möglich.
3. Behebe die Ursache, nicht nur das Symptom. Keine Tests deaktivieren.
4. Committe, pushe auf {{pr.headBranch}} und beobachte, ob die Checks grün werden.

{{user.note}}`,
  },
  {
    id: "builtin:reply-comment",
    name: "Auf Kommentar reagieren",
    actionLabel: "Kommentar umsetzen",
    description: "Einen einzelnen Review-Kommentar umsetzen oder beantworten.",
    builtin: true,
    defaultTarget: "existing",
    defaultSendMode: "queue",
    requires: ["comment"],
    body: `${PREAMBLE}

Im Pull Request {{pr.url}} (Branch {{pr.headBranch}}) gibt es folgenden Review-Kommentar{{comment.location}}:

> {{comment.text}}

Setze den Punkt um, falls berechtigt, oder antworte im Thread mit einer kurzen Begründung, falls nicht. Pushe Änderungen auf {{pr.headBranch}} und antworte im Kommentar-Thread, was passiert ist.

{{user.note}}`,
  },
  {
    id: "builtin:summarize",
    name: "PR zusammenfassen",
    actionLabel: "Zusammenfassen",
    description: "Fachliche Einordnung, Risiken und offene Fragen. Keine Codeänderungen.",
    builtin: true,
    defaultTarget: "new",
    body: `${PREAMBLE}

Fasse den Pull Request {{pr.url}} („{{pr.title}}“) zusammen: Was ändert sich fachlich, welche Risiken gibt es, welche Stellen verdienen besondere Aufmerksamkeit im Review, welche Fragen sind offen. Keine Codeänderungen.

{{user.note}}`,
  },
  {
    id: "builtin:free",
    name: "Freier Prompt",
    actionLabel: "Freier Prompt",
    description: "Nur dein Text plus PR-Kontext.",
    builtin: true,
    defaultTarget: "new",
    requires: ["note"],
    body: `${PREAMBLE}

{{user.note}}`,
  },
];

export const REVIEW_OUTPUT_TEXT = {
  inline:
    "Poste konkrete Findings als Inline-Review-Kommentare auf dem Pull Request, nach Schwere sortiert. Keine Stilnörgelei ohne Nutzen.",
  report:
    "Poste nichts auf GitHub. Liste die Findings hier im Thread, nach Schwere sortiert, mit Datei und Zeile. Keine Stilnörgelei ohne Nutzen.",
} as const;
