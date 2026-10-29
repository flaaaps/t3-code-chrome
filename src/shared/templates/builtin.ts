import type { PromptTemplate } from "../models";

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: "builtin:review",
    name: "Review durchführen",
    description: "Vollständiges Code-Review der PR, Findings als Inline-Kommentare.",
    builtin: true,
    defaultTarget: "new",
    preferWorktree: true,
    body: `Führe ein gründliches Code-Review für die Pull Request {{pr.url}} durch ("{{pr.title}}", Branch {{pr.headBranch}} → {{pr.baseBranch}}).

Vorgehen:
1. Hole Diff, Beschreibung, bestehende Review-Kommentare und den Status der Checks (z. B. mit \`gh pr view\`, \`gh pr diff\`, \`gh api\`). Falls ein gespeicherter Review-Guide für diese PR existiert, halte dich daran.
2. Prüfe Korrektheit, Randfälle, Sicherheit, Performance und Testabdeckung. Verifiziere Behauptungen im Code, nicht nur im Diff.
3. Poste konkrete Findings als Inline-Review-Kommentare auf der PR, nach Schwere sortiert. Keine Stilnörgelei ohne Nutzen.
4. Fasse am Ende zusammen: Merge-Empfehlung (approve / request changes) mit Begründung.

{{user.note}}`,
  },
  {
    id: "builtin:address-review",
    name: "Review-Kommentare abarbeiten",
    description: "Offene Review-Threads beantworten oder fixen, pushen, Threads auflösen.",
    builtin: true,
    defaultTarget: "existing",
    defaultSendMode: "queue",
    preferWorktree: true,
    body: `Arbeite die offenen Review-Kommentare der Pull Request {{pr.url}} ab (Branch {{pr.headBranch}}).

Vorgehen:
1. Lies alle offenen (nicht aufgelösten) Review-Threads und allgemeinen Kommentare der PR.
2. Setze berechtigte Änderungswünsche im Code um. Wo du anderer Meinung bist, antworte sachlich im jeweiligen Thread statt zu ändern.
3. Führe die relevanten Tests und Linter aus.
4. Committe mit aussagekräftiger Nachricht, pushe auf {{pr.headBranch}} und antworte in jedem bearbeiteten Thread kurz, was geändert wurde. Löse erledigte Threads auf.
5. Melde am Ende, welche Punkte umgesetzt wurden und welche offen bleiben und warum.

{{user.note}}`,
  },
  {
    id: "builtin:fix-ci",
    name: "CI-Fehler beheben",
    description: "Fehlgeschlagene Checks analysieren und fixen.",
    builtin: true,
    defaultTarget: "new",
    preferWorktree: true,
    body: `Die Checks der Pull Request {{pr.url}} (Branch {{pr.headBranch}}) schlagen fehl.

Vorgehen:
1. Ermittle die fehlgeschlagenen Checks und ihre Logs (z. B. \`gh pr checks\`, \`gh run view --log-failed\`).
2. Reproduziere das Problem lokal, wo möglich.
3. Behebe die Ursache, nicht nur das Symptom. Keine Tests deaktivieren.
4. Committe, pushe auf {{pr.headBranch}} und beobachte, ob die Checks grün werden.

{{user.note}}`,
  },
  {
    id: "builtin:reply-comment",
    name: "Auf Kommentar reagieren",
    description: "Einen einzelnen Review-Kommentar umsetzen oder beantworten.",
    builtin: true,
    defaultTarget: "existing",
    defaultSendMode: "queue",
    body: `In der Pull Request {{pr.url}} (Branch {{pr.headBranch}}) gibt es folgenden Review-Kommentar:

> {{selection}}

Setze den Punkt um, falls berechtigt, oder antworte im Thread mit einer kurzen Begründung, falls nicht. Pushe Änderungen auf {{pr.headBranch}} und antworte im Kommentar-Thread, was passiert ist.

{{user.note}}`,
  },
  {
    id: "builtin:summarize",
    name: "PR zusammenfassen",
    description: "Kurze Einordnung der Änderungen, Risiken und offene Fragen.",
    builtin: true,
    defaultTarget: "new",
    body: `Fasse die Pull Request {{pr.url}} ("{{pr.title}}") zusammen: Was ändert sich fachlich, welche Risiken gibt es, welche Stellen verdienen besondere Aufmerksamkeit im Review, welche Fragen sind offen. Keine Codeänderungen.

{{user.note}}`,
  },
  {
    id: "builtin:free",
    name: "Freier Prompt",
    description: "Nur der eigene Text plus PR-Kontext.",
    builtin: true,
    defaultTarget: "new",
    body: `{{user.note}}`,
  },
];
