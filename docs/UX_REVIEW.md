# UX-Review: T3 Code for GitHub (Chrome-Extension)

> **Status (2026-10-29):** Umgesetzt. Phase 1 bis 3 sind in `main` implementiert: Split-Button mit Countdown-Toast, inline Agent-Box mit Antworten/Nachschieben/Stop, Composer-Drawer mit Ziel-Combobox, Kommentar-Menü, Popup als Inbox mit Erstlauf-Wizard, Aktionen-Editor mit Live-Vorschau, deutsche Fehlertexte, Fokus- und Tastaturführung. Offen bleiben die optionalen Punkte aus Phase 3 (Floating-Aktion bei Diff-Textauswahl, Kurzantworten aus Agentenfragen, Watch-Integration). Der Text darunter ist der ursprüngliche Review.

Stand: 2026-10-29. Geprüft wurde der Build aus `main` (55f95b1) gegen den laufenden T3-Code-Server 0.1.4 und die öffentliche PR `flaaaps/pondus#5`. Alle referenzierten Screenshots liegen unter `test/e2e/out/review/` (eigene Aufnahmen) bzw. `test/e2e/out/` (Aufnahmen des E2E-Laufs). Es wurden keine Threads gestartet; Jobs für Status-Screenshots wurden lokal in `chrome.storage` eingespielt.

---

## 1. Executive Summary

Die Extension ist technisch solide und löst das Versprechen „PR an T3 übergeben, ohne die Seite zu verlassen" bereits ein: Projekt-Matching, PR-verknüpfte Threads zuerst, Worktree auf dem PR-Branch, Status-Badge und Benachrichtigungen funktionieren. Das Problem ist nicht die Technik, sondern die Form: Die Oberfläche ist ein **Formular mit 27 Bedienelementen in acht Abschnitten**, das bei jedem Öffnen die komplette Konfigurationsmatrix (Vorlage × Ziel × Projekt × Arbeitsverzeichnis × Modell × Modus × Titel × Hinweis × Prompt) ausbreitet, obwohl für den 90-%-Fall jede dieser Entscheidungen schon getroffen ist. Das Produkt optimiert auf *Konfigurieren* statt auf *Delegieren und Steuern*.

Noch gravierender für jemanden, der den ganzen Tag an Agenten delegiert: Die Extension kann **senden, aber nicht antworten**. Der Zustand „wartet auf dich" wird angezeigt, aber die Antwort darauf erfordert den Wechsel in die Desktop-App. Damit ist genau der Loop unterbrochen, für den die Extension existiert. Die letzte Agenten-Antwort, die wichtigste Information überhaupt, ist standardmäßig hinter einem Link versteckt.

**Die wichtigste Änderung:** Das Panel vom Formular zur *Aktion plus Aktivität* umbauen. Im PR-Header ein Split-Button mit Primäraktion („Review starten", mit allen smarten Defaults, sofort ausgeführt, 5 Sekunden abbrechbar), daneben ein Menü für die anderen Absichten und „Anpassen…". Unter dem PR-Header ein inline eingebetteter Status-Streifen pro Session (Status, letzte Agentennachricht, Antwortfeld, Stop) — vergleichbar mit GitHubs Merge-Box, nur für Agenten. Das heutige Panel schrumpft zum optionalen Composer für den Long Tail.

Zweitwichtigste Änderung: Fehler- und Erstlaufzustände ehrlich machen. „Läuft die Desktop-App?" erscheint auch, wenn die App läuft und nur das Pairing fehlt; englische Server-Fehlermeldungen stehen neben deutschem UI; das Pairing setzt Terminalwissen voraus.

---

## 2. Was gut funktioniert

- **Smarte Vorauswahl stimmt.** Projekt wird per `repositoryIdentity.canonicalKey` erkannt (`src/shared/sort.ts:5`), Threads mit PR-Link stehen oben, Worktree auf `origin/<headBranch>` ist Default. Das ist die richtige Grundlage für Ein-Klick-Delegation.
- **Architektur erlaubt den Umbau.** Der Content-Script bekommt fertige View-Models (`PrSuggestions`), der Worker kapselt MCP/Auth/Jobs. Ein neues UI braucht keine Backend-Änderung; `t3_thread_send`, `t3_thread_interrupt`, `t3_pending_request` sind bereits über denselben Transport erreichbar.
- **Primer-Tokens im Shadow DOM** (`src/content/ui/styles.ts:4-25`): Farben, Radius, Schrift folgen GitHub; das Panel wirkt nicht wie ein Fremdkörper. Dark Mode in Popup/Optionen ist sauber (`23-popup-dark.png`, `27-options-dark.png`).
- **Status-Signal am Trigger** (Punkt + Zähler, `11-trigger-zoom.png`) ist eine gute Idee und sollte zum zentralen Element wachsen.
- **Sicherheitsmodell ist sinnvoll:** Token nur im Worker, kein Diff-Transfer, Revoke in T3.
- **Prompt-Texte sind inhaltlich brauchbar:** Vorgehen nummeriert, „Ursache nicht Symptom", „keine Stilnörgelei", Merge-Empfehlung am Ende.

---

## 3. Findings (nach Wirkung sortiert)

### F1 — Der Kernloop ist ein Formular, keine Aktion (Impact: sehr hoch, Aufwand: M)

**Problem.** Für „Ich will diese PR reviewt haben" sind es nominell 2 Klicks (Trigger → „Session starten"), aber dazwischen liegen ~1,5 s Laden plus die kognitive Arbeit, acht Abschnitte zu überfliegen und zu prüfen, ob die Defaults stimmen. Jede Sitzung fängt bei null an: Vorlage, Ziel, Projekt, Arbeitsverzeichnis, Modell/Modus/Titel, Hinweis, Kommentar, Prompt-Vorschau. Ein Experte will im Normalfall gar nichts davon sehen; ein Neuling versteht die Hälfte nicht („Worktree auf PR-Branch" vs. „Projekt-Checkout").

**Evidenz.** `test/e2e/out/04-panel-new-session.png`, `review/13-panel-with-joblist.png`; 27 fokussierbare Controls (gemessen). `src/content/ui/Panel.tsx:323-582` rendert alle Abschnitte immer.

**Vorschlag.** Primäraktion in den PR-Header: Split-Button `[▶ Review starten] [▾]`. Klick links = sofortiger Dispatch mit Defaults (Vorlage „Review", erkanntes Projekt, Worktree, Standardmodell) und einem 5-Sekunden-Toast „Review wird gestartet… Abbrechen · Anpassen". Das Menü rechts listet die weiteren Absichten (Kommentare abarbeiten, CI fixen, Zusammenfassen, Freier Prompt) sowie „Anpassen…" (öffnet den Composer). Der Composer zeigt genau *eine* Zeile Ziel („An: Neue Session in Pondus · Worktree fix/no-active-workout-screen ▾") und *ein* Textfeld; alles andere liegt unter „Erweitert".

### F2 — Die Extension kann senden, aber nicht antworten (Impact: sehr hoch, Aufwand: M)

**Problem.** Status „wartet auf dich" wird prominent angezeigt (rote Chip-Farbe!), aber es gibt kein Antwortfeld. Der Nutzer muss „In T3 öffnen" klicken und in der Desktop-App weitermachen — der versprochene Loop „ohne die PR-Seite zu verlassen" bricht exakt an der Stelle, wo der Agent Input braucht. Auch Stop/Interrupt fehlt. Die Information, *worauf* der Agent wartet (die Frage), ist hinter „Letzte Antwort anzeigen" versteckt (`src/content/ui/JobList.tsx:56-63`).

**Evidenz.** `review/13-panel-with-joblist.png` (Karte „wartet auf dich" ohne Eingabe), `test/e2e/out/07-completed.png`.

**Vorschlag.** Jede Job-Karte bekommt: (a) letzte Agentennachricht immer sichtbar (max. 3 Zeilen, aufklappbar), (b) bei `waiting` zusätzlich `t3_pending_request` anzeigen (Freigabe-Request vs. Frage) und ein einzeiliges Antwortfeld mit `Enter` → `t3_thread_send` (mode `auto`), (c) bei `running` einen Stop-Button (`t3_thread_interrupt`) und ein Feld „Nachschieben…" (mode `queue`), (d) „In T3 öffnen" bleibt als sekundäre Aktion. Das ist das Herzstück für agentisches Arbeiten.

### F3 — Fehlerzustände lügen oder sprechen Englisch (Impact: hoch, Aufwand: S)

**Problem.**
- Nicht gekoppelt, App läuft: Panel sagt „Keine erreichbare T3-Code-Verbindung. Läuft die Desktop-App?" (`review/35-panel-not-paired.png`). Ursache: `src/background/router.ts:97-101` prüft nur `reachable`, unterscheidet aber nicht `unauthenticated` von `unreachable`. Der Nutzer sucht am falschen Ort.
- Server-Fehler sind englisch mitten im deutschen UI: „T3 Code is not reachable at that address." (`review/32-options-add-unreachable.png`), „T3 Code rejected the pairing code: That pairing code is unknown, expired, or already used." (`review/34-options-pair-failed.png`).
- Beim „Ohne Projekt"-Fall ist die Meldung „Kein T3-Projekt mit Repository … gefunden. Wähle manuell oder lege das Projekt in T3 an." korrekt, bietet aber keine Aktion (Projekt anlegen via `t3_project_create` wäre möglich).

**Vorschlag.** Fehlercodes im Panel auf drei klare Zustände mappen, jeweils mit *einer* passenden Aktion: „T3 Code läuft nicht" → „Erneut prüfen"; „Nicht gekoppelt" → „Jetzt koppeln" (öffnet Pairing direkt, nicht die Optionen-Übersicht); „Kein Projekt für dieses Repo" → „Projekt anlegen" / „In Scratch starten". Alle Server-Fehler im Worker übersetzen (`src/shared/errors.ts` um `userMessage` ergänzen).

### F4 — Erstlauf verlangt Terminalwissen und endet im Nichts (Impact: hoch, Aufwand: M)

**Problem.** Nach Installation: Popup „Noch keine Verbindung" → Optionen → Server „Hinzufügen" (obwohl die lokale Adresse immer gleich ist) → Pairing-Code aus T3-Settings oder `t3 auth pairing create …` → Access-Level wählen (fünf Optionen mit Konsequenzen, die ein Neuling nicht einschätzen kann) → „Koppeln". Danach keine Rückmeldung, was man jetzt tun soll. Es gibt keinen Wizard, keinen „Jetzt eine PR öffnen"-Link, keinen Test-Button.

**Evidenz.** `review/31-options-firstrun.png`, `review/33-options-added-not-paired.png`, `test/e2e/out/01-options-connected.png`.

**Vorschlag.** Dreischrittiger Wizard im Popup (und als Zustand im Panel): (1) „T3 Code gefunden auf 127.0.0.1:3773 ✓" automatisch beim ersten Öffnen, kein „Hinzufügen"-Schritt; (2) „Code aus T3 Code einfügen" mit Deep Link `t3code://settings/connections` plus Fallback-CLI-Befehl zum Kopieren; Access-Level als zwei Optionen „Vollzugriff (empfohlen für Reviews, die pushen)" / „Nur lesen"; (3) „Fertig — öffne eine PR" mit Link auf die zuletzt besuchte PR. Der heutige Optionen-Tab bleibt für Mehrfach-Server.

### F5 — Zielwahl mischt Häufigkeit mit Expertenoptionen (Impact: hoch, Aufwand: M)

**Problem.** Segment „Neue Session | Bestehende Session (136)" + Projekt-Select + Arbeitsverzeichnis-Segment + Details „Modell, Modus, Titel" + Sendemodus-Select. „Bestehende Session" zeigt ohne PR-Link standardmäßig alle 136 Threads aller Projekte; „nur diese PR" ist nur angehakt, wenn T3 schon eine Verknüpfung kennt (`Panel.tsx:95-98`). Der Sendemodus (queue/steer/restart/auto) ist ein echtes Steuerkonzept, wird aber als ewig sichtbarer Select mit Jargon („Als nächsten Turn – läuft nach dem aktuellen Turn") präsentiert, selbst wenn der Ziel-Thread gar nicht läuft. Der Environment-Select hängt unmotiviert in der Label-Zeile „Ziel".

**Evidenz.** `review/15-panel-existing-all.png`, `test/e2e/out/05-panel-existing-session.png`, `Panel.tsx:345-538`.

**Vorschlag.** Ein einziges Ziel-Combobox mit Gruppen: „Diese PR" (verknüpfte Sessions, mit Status), „Neu in Pondus" (Worktree · Standardmodell), „Andere Sessions in Pondus", „Alle Sessions…" (Suche via `t3_thread_search`). Sendemodus nur anzeigen, wenn der gewählte Thread `running` ist, als zwei Buttons „Nach dem aktuellen Schritt" / „Sofort" (statt vier Optionen), Default `auto`. Environment nur als Gruppe im Combobox, wenn >1.

### F6 — „Vorlagen" sind Absichten, und die Prompts haben Lücken (Impact: mittel-hoch, Aufwand: S–M)

**Problem.**
- Konzept: Die Chips heißen „Vorlage", der Nutzer denkt aber in Absichten („Review", „CI fixen"). Vorlage klingt nach Textbaustein, den man noch ausfüllt.
- „Freier Prompt" mit leerer Notiz ist absendbar: `{{user.note}}` → „" und dann hängt `renderTemplate` die Kontext-Fußzeile an, der Prompt ist nicht leer (`src/shared/templates/render.ts:35-39`), `canSubmit` wird wahr (`Panel.tsx:228`). Ergebnis: ein Thread, der nur „Kontext: Pull Request …" bekommt. Gleiches gilt für „Auf Kommentar reagieren" ohne Auswahl (`> ` leeres Zitat).
- Der Review-Prompt postet Inline-Kommentare auf GitHub *im Namen des Nutzers* — nebenwirkungsbehaftet, nicht rückgängig zu machen — ohne Hinweis oder die Alternative „nur Bericht in T3 / Draft-Review" (`builtin.ts:16`).
- Keine Vorlage erwähnt die T3-eigenen PR-Werkzeuge (`link_pull_request`, `read_pull_request_guide`, `watch_pull_request`), die der Plan (Abschnitt 4) nennt; nur `gh`. Damit entsteht die PR-Verknüpfung erst, wenn der Agent sie zufällig setzt.
- Variablen fehlen, die den Unterschied machen: `{{pr.description}}`, `{{pr.changedFiles}}` (Liste), `{{pr.failedChecks}}`, `{{comment.file}}`/`{{comment.line}}`/`{{comment.url}}` als strukturierte Felder statt des Freitextblocks aus `describeComment()` (`prContext.ts:91-112`).
- Template-Metadaten (`defaultTarget`, `defaultSendMode`) sind Optionen-Seiten-Konfiguration, obwohl sie Laufzeit-Entscheidungen sind.

**Vorschlag.** Umbenennen in „Aktion" bzw. gar kein Label (die Chips sprechen für sich). Leere Pflichtvariablen blockieren das Senden (Hinweis im Button: „Notiz fehlt"). Review-Vorlage bekommt einen Schalter „Ergebnis: Inline-Kommentare auf GitHub / Nur Bericht" (bei Inline: Hinweis „postet als @flaaaps"). Alle Vorlagen beginnen mit „Verknüpfe den Thread mit {{pr.url}} (`link_pull_request`) und lies den Review-Guide, falls vorhanden." Variablen ergänzen; Kommentarfelder strukturieren.

### F7 — Statusmodell: Farben, Timing und Sichtbarkeit (Impact: mittel, Aufwand: S)

**Problem.**
- „wartet auf dich" ist in Danger-Rot (`styles.ts:116`) — liest sich wie ein Fehler. Warten auf Input ist ein *Attention*-Zustand (gelb/orange) oder ein eigener Akzent.
- `relativeTime(job.updatedAt)` zeigt die Zeit des letzten *Polls*, nicht der letzten Thread-Aktivität; bei 30-s-Polling steht permanent „gerade eben" (`JobList.tsx:53`, `jobs.ts:122`).
- Polling über `chrome.alarms` (min. 30 s) plus `t3_thread_wait` 20 s: Statuswechsel kommen bis zu einer halben Minute verzögert; ein manueller „Aktualisieren"-Link kompensiert das sichtbar für den Nutzer — ein Workaround als Feature.
- Job-Karte und Thread-Liste zeigen denselben Thread doppelt (einmal als Job, einmal als „diese PR"-Thread, `07-completed.png`).

**Vorschlag.** Farbsemantik: running = accent (blau, pulsierend), waiting = attention (gelb) mit Glocke, completed = success, failed = danger. Zeit aus `thread.updatedAt`. Während das Panel offen ist, Polling auf 5 s (Port offen hält den Worker wach) und `t3_thread_wait` mit längerem Timeout als Pseudo-Push. Jobs und verknüpfte Threads zu *einer* Liste „Sessions zu dieser PR" zusammenführen.

### F8 — Auffindbarkeit: Fallback-Button und das nackte „T3" (Impact: mittel, Aufwand: S)

**Problem.** Ohne GitHub-Login (und bei jeder Markup-Abweichung) landet der Trigger als schwebender Button unten rechts (`test/e2e/out/03-pr-with-trigger.png`), ohne Tooltip-Hinweis, wofür er da ist. Der Kommentar-Button ist ein unscheinbares „T3" in `fg-muted` ohne Icon direkt neben „Owner" (`review/12-comment-button-zoom.png`); er erscheint am PR-Beschreibungstext (Issue-Body), der kein Review-Kommentar ist. Auf `/files` wurden 0 Buttons eingefügt (`review/21-files-tab.png`; die PR hat keine Review-Threads, die neuen `[data-testid]`-Selektoren sollten gegen eine PR mit Review-Kommentaren verifiziert werden). Das Kontextmenü „Mit T3 Code bearbeiten…" ist nur über Rechtsklick auf markierten Text erreichbar — unsichtbar.

**Vorschlag.** Header-Button mit T3-Icon (Octicon-Stil, 16 px) und Status-Chip; Fallback nicht schwebend, sondern als Zeile direkt unter dem PR-Titel. Kommentar-Button: Icon + Dropdown „Umsetzen / Beantworten / An Session anhängen", Primer-`btn-octicon`-Look, nur an echten Review-Kommentaren. Zusätzlich: beim Markieren von Text im Diff eine kleine Floating-Aktion „An T3 →" (wie GitHubs eigenes „Add comment"-Plus).

### F9 — Tastatur, Fokus, Screenreader (Impact: mittel, Aufwand: S)

**Problem.** Fokus-Stil nur für `select/input/textarea` (`styles.ts:98`); Chips, Segmente, Buttons, Thread-Optionen haben keinen sichtbaren Fokusring (`review/18-focus-chip.png`). Das Panel ist eine `<section>` ohne `role="dialog"`/`aria-labelledby`, Fokus wandert beim Öffnen nicht hinein und wird beim Schließen nicht zurückgesetzt (`App.tsx:56-63`). Der `role="listbox"` hat keine Pfeiltasten-Navigation (`Panel.tsx:625-650`). Icon-Buttons sind Unicode-Glyphen (↻ ⚙ ✕) mit `title`, aber ohne `aria-label`. `Alt+Shift+T` kollidiert auf macOS mit Sonderzeichen-Eingabe (ˇ) und ist nirgends im Panel sichtbar.

**Vorschlag.** `:focus-visible`-Ring auf alle interaktiven Elemente (Primer: 2 px accent, offset 2 px); `role="dialog" aria-modal="false" aria-labelledby`; Fokus beim Öffnen auf das erste sinnvolle Element (Textfeld), Rückgabe an den Trigger; Listbox mit `↑↓`/`Enter`; `Cmd/Ctrl+Enter` sendet; Shortcut im Footer anzeigen.

### F10 — Visuelle Hierarchie und Dichte (Impact: mittel, Aufwand: S)

**Problem.** Drei konkurrierende Akzentfarben (Brand-Lila `#4f46e5`, Primer-Blau für aktive Chips/Segmente, Grün für den Primär-Button). Sechs gleichwertige Label-Zeilen in 12 px Semibold; nichts ist visuell wichtiger als anderes. Das Panel überdeckt bei 1000 px Breite fast die Hälfte der PR, bei 760 px fast alles (`review/19-narrow-1000.png`, `review/20-narrow-760.png`) — der Inhalt, über den der Nutzer entscheidet, ist dann nicht mehr lesbar. Das Details-Element „Modell, Modus, Titel" ist eine Grabbeltüte. Der Primär-Button erscheint nach dem ersten Öffnen gedimmt, obwohl `disabled=false` (Stale Paint des `:disabled`-Stils; `review/37-btn-a-initial.png` vs. `37-btn-c-after-chip.png`) — er sieht aus, als könne man nicht senden.

**Vorschlag.** Eine Akzentfarbe (Primer-Accent), Brand-Lila nur im Logo. Hierarchie: Textfeld groß und zuerst, Ziel als eine Zeile, Rest unter „Erweitert". Panel schmaler (380 px) *oder* als Inline-Streifen in der Seite (siehe Zieldesign). Stale Paint: `disabled`-Styling über Klasse statt nur Pseudo-Klasse setzen oder bei Statuswechsel das Element neu keyen.

### F11 — Popup zieht sein Gewicht nicht (Impact: mittel, Aufwand: M)

**Problem.** Das Popup zeigt Verbindungsstatus, einen Hinweis „Öffne eine Pull Request…" und Job-Zeilen mit zwei kryptischen Buttons „PR" / „T3" (`review/22-popup-with-jobs.png`). Es dupliziert die Job-Liste des Panels ohne Mehrwert und kann nichts, was das Panel nicht auch kann. Der Hinweis erscheint auch, wenn man gar nicht auf GitHub ist (sinnvoll), aber die wichtigste Frage „Wartet gerade irgendein Agent auf mich?" wird nicht als Erstes beantwortet.

**Vorschlag.** Popup wird die **Inbox**: Sektionen „Wartet auf dich (2)" (zuerst, mit Frage und Antwortfeld), „Läuft (1)", „Fertig heute". Jede Zeile: PR-Titel, Thread-Titel, letzte Nachricht, Aktionen „Antworten / PR öffnen / In T3". Nicht gekoppelt → Wizard (F4). Ohne Sessions → ein Satz plus Link auf die letzte PR.

### F12 — Optionen: richtige Inhalte, falscher Ort für das Pairing (Impact: niedrig-mittel, Aufwand: S)

**Problem.** Pairing (einmalig, kritisch) teilt sich die Seite mit Vorlagen und Defaults. Der Vorlagen-Editor hat keine Vorschau mit echten PR-Daten; die Platzhalterliste ist ein Textblock (`review/24-options-templates.png`, `25-options-template-editor.png`). „Zurücksetzen" in Rot neben jeder mitgelieferten Vorlage sieht nach Löschen aus. Einstellung „Standard-Modus: Full access" mit dem Hinweis „Kann nicht über das Zugriffslevel der Verbindung hinausgehen" ist für Nicht-Experten undurchsichtig.

**Vorschlag.** Pairing in den Wizard (F4); Optionen behalten „Verbindungen" (Liste, Mehrfach-Server), „Aktionen" (Editor mit Live-Vorschau gegen eine Beispiel-PR, Platzhalter als klickbare Chips, Zurücksetzen nur im Editor), „Einstellungen". Zugriffslevel als eine Zeile mit Erklärung des effektiven Levels.

### F13 — Deutsche Texte (Impact: niedrig, Aufwand: S)

- Genus: „die Pull Request" in allen Vorlagen; im deutschen GitHub-Sprachgebrauch ist „der Pull Request" üblich. Einheitlich entscheiden.
- „Sofort einsteuern", „Als nächsten Turn" sind Übersetzungsjargon. Besser: „Nach dem aktuellen Schritt", „Sofort einlenken", „Neu beginnen".
- „Hinweis für den Agenten optional" — das Feld ist bei „Freier Prompt" nicht optional (siehe F6).
- Gemischte Sprache in Datenwerten: „No project" (aus T3) neben „fertig".
- Statusverb „wartet auf dich" ist gut; „zurückgerollt" für `rolled_back` ist unklar → „verworfen".

### F14 — Mehrere Sessions pro PR und Beziehung zu GitHub-UI (Impact: mittel, Aufwand: L)

**Problem.** Mehrere parallele Sessions (Review + CI-Fix) sind möglich, aber nirgends als Konzept sichtbar: keine Übersicht „was läuft gerade auf dieser PR und wer macht was", keine Konflikthinweise (zwei Sessions pushen auf denselben Branch), keine Verbindung zu Checks (CI rot → „CI fixen" anbieten) oder Review-Status (Changes requested → „Kommentare abarbeiten" anbieten). Die Extension liest `reviewDecision` und `state` aus dem DOM (`prContext.ts`), nutzt sie aber nur als Template-Variablen.

**Vorschlag.** Kontextsensitive Primäraktion: Draft → „Zusammenfassen"; Checks rot → „CI fixen"; Changes requested & eigene PR → „Kommentare abarbeiten"; sonst → „Review". Im Status-Streifen Warnung „2 Sessions arbeiten auf `fix/…`". Nach Abschluss eines Reviews: Link auf den geposteten Review (`#pullrequestreview-…`), falls der Agent ihn zurückmeldet.

---

## 4. Zieldesign

### Leitidee

Drei Oberflächen statt einer:

1. **Aktion** — Split-Button im PR-Header. Ein Klick delegiert mit Defaults.
2. **Aktivität** — Inline-Streifen unter dem PR-Header („Agent-Box"). Zeigt alle Sessions dieser PR, erlaubt Antworten, Nachschieben, Stoppen. Lebt *in* der Seite, nicht darüber.
3. **Composer** — rechter Drawer, nur für „Anpassen…" und Freitext. Textfeld zuerst, Ziel als eine Zeile, Rest unter „Erweitert".

Dazu das Popup als globale Inbox und ein Erstlauf-Wizard.

### 4.1 PR-Header: Aktion

```
fix(workout): kein "Kein aktives Workout"-Screen …  #5
 Merged  flaaaps merged 2 commits into main from fix/no-active-workout-screen

                      [ Edit ] [ <> Code ▾ ]   [ ◉ 1 wartet ] [ ▶ Review starten | ▾ ]
                                                                        │
                                              ┌─────────────────────────┴──────────────┐
                                              │ ▶ Review starten        (Standard)      │
                                              │   Review-Kommentare abarbeiten          │
                                              │   CI-Fehler beheben          ● 1 rot    │
                                              │   PR zusammenfassen                     │
                                              │   Freier Prompt…                        │
                                              ├─────────────────────────────────────────┤
                                              │   Anpassen…                 ⌥⇧T        │
                                              │   Ziel: Neu in Pondus · Worktree  ▸     │
                                              └─────────────────────────────────────────┘
```

- Die Beschriftung des Primär-Buttons folgt dem PR-Kontext (F14). Der Chip „◉ 1 wartet" ist die Statusanzeige des Triggers und öffnet/scrollt zur Agent-Box.
- Nach Klick: Toast unten rechts „Review wird in 5 s gestartet · Neue Session in Pondus (Worktree) — **Abbrechen** · Anpassen". Nach Ablauf: Dispatch, Toast wird „Gestartet · Öffnen".

### 4.2 Agent-Box (inline, unter dem Header, vor dem Timeline-Start)

```
┌─ T3 Code · Sessions zu dieser PR ──────────────────────────────────────── [−] ─┐
│                                                                                 │
│ ● wartet   Review durchführen                     claude-opus-5-5 · vor 2 min  │
│   ┃ Ich habe 3 Findings. Soll ich sie als Inline-Kommentare posten oder zuerst │
│   ┃ die Testabdeckung prüfen?                                                  │
│   [ Antwort…                                              ] [Senden] [■ Stop]   │
│   Ja, posten · Erst Tests · In T3 öffnen                                       │
│                                                                                 │
│ ◌ läuft    CI-Fehler beheben                      gpt-6-luna · vor 40 s        │
│   ┃ Reproduziere den Jest-Fehler in live-activity.test.ts …                    │
│   [ Nachschieben…                                         ] [Queue ▾] [■ Stop]  │
│                                                                                 │
│ ✓ fertig   PR zusammenfassen                      vor 1 h · Ausblenden         │
│   ┃ Die PR behebt drei Navigationsfälle …                           [mehr]     │
│                                                                                 │
│ ⚠ 2 Sessions arbeiten auf fix/no-active-workout-screen.                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Erscheint nur, wenn Sessions zu dieser PR existieren; sonst nichts (kein leerer Kasten).
- Die letzte Agentennachricht ist immer sichtbar (3 Zeilen, „mehr" klappt auf).
- Bei `waiting` mit `t3_pending_request`: Freigabe-Requests als Buttons „Erlauben / Ablehnen"; Fragen als Antwortfeld. Kurzantworten aus der Frage extrahiert (optional, Phase 3).
- `[Queue ▾]` ist der einzige Ort für den Sendemodus; nur sichtbar bei `running`.
- Zusammengeklappt bleibt eine einzeilige Leiste: „T3 Code · ● 1 wartet · ◌ 1 läuft · ✓ 1 fertig".

### 4.3 Composer (Drawer rechts, 380 px, nur auf „Anpassen…"/Freier Prompt/Kommentar-Aktion)

```
┌─────────────────────────────────────────────┐
│ T3  Review durchführen                  ✕   │
│ [Review] [Kommentare] [CI] [Zusammenf.] [Frei]│
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ Fokus auf die Offline-Synchronisation,  │ │
│ │ Live-Activity-Code nur überfliegen.     │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│ Prompt ansehen/bearbeiten ▸                 │
│                                             │
│ An  [ Neu in Pondus · Worktree fix/… ▾ ]    │
│      ├ Diese PR                             │
│      │  ● Review durchführen (wartet)       │
│      ├ Neu                                  │
│      │  ○ Pondus · Worktree · Opus 5.5      │
│      │  ○ Pondus · Projekt-Checkout         │
│      ├ Pondus, zuletzt                      │
│      │  ○ Live Activities Spike (fertig)    │
│      └ Alle Sessions durchsuchen…           │
│                                             │
│ Ergebnis  (● Inline-Kommentare auf GitHub)  │
│           (○ Nur Bericht in T3)             │
│                                             │
│ Erweitert ▸  Modell · Modus · Titel · Env   │
├─────────────────────────────────────────────┤
│ postet als @flaaaps        [ Starten ⌘↩ ]   │
└─────────────────────────────────────────────┘
```

- Das Textfeld hat beim Öffnen den Fokus. `⌘/Ctrl+Enter` sendet.
- Bei Kommentar-Aktion: oben ein Zitat-Block mit Datei:Zeile und Link, entfernbar; Ziel springt auf die verknüpfte laufende Session.
- „Prompt ansehen/bearbeiten" zeigt den gerenderten Text mit hervorgehobenen Variablen.

### 4.4 Kommentar-Aktion

```
flaaaps  commented 2 days ago                     Owner   [T3 ▾]  …
                                                           ├ Umsetzen
                                                           ├ Beantworten
                                                           └ An „Review durchführen" anhängen
```

### 4.5 Popup als Inbox

```
┌ T3 Code ─────────────────────────── ⚙ ┐
│ ● Wartet auf dich (1)                 │
│ ┌───────────────────────────────────┐ │
│ │ pondus#5 · Review durchführen     │ │
│ │ „Soll ich die Findings posten…?"  │ │
│ │ [ Antwort…            ] [Senden]  │ │
│ │ PR öffnen · In T3                 │ │
│ └───────────────────────────────────┘ │
│ ◌ Läuft (1)                           │
│   pondus#5 · CI-Fehler beheben · 40 s │
│ ✓ Heute fertig (3)                 ▸  │
│                                       │
│ MacBook Pro (2) · verbunden           │
└───────────────────────────────────────┘
```

### 4.6 Zustände

| Zustand | Header | Agent-Box | Composer |
|---|---|---|---|
| Nicht gekoppelt | Button „T3 Code einrichten" | — | Wizard-Schritt 2 inline |
| App läuft nicht | Button grau „T3 Code offline · erneut prüfen" | letzte bekannte Jobs, grau | Fehlerbanner mit Retry |
| Kein Projekt | Primär „Projekt anlegen & Review starten" | — | Ziel zeigt „Projekt anlegen…" / „Scratch" |
| Laden | Button mit Spinner, Klick wird gepuffert | Skeleton | Skeleton |
| Dispatch läuft | Toast mit Abbrechen | Karte „startet" erscheint sofort (optimistisch) | schließt |
| Fehler beim Senden | — | — | Banner mit Fehler, Prompt bleibt erhalten |

---

## 5. Phasenplan

### Phase 1 — Quick Wins (1–2 Tage, alles S)

1. Fehlerzustände ehrlich: `unauthenticated` vs. `unreachable` im Panel unterscheiden (`router.ts:97`), Server-Fehler übersetzen, Aktion pro Zustand (F3).
2. Letzte Agentenantwort standardmäßig sichtbar, Zeit aus `thread.updatedAt`, Farbsemantik (waiting = attention) (F7).
3. Leeren Prompt blockieren; Pflichtvariablen prüfen (F6).
4. `:focus-visible` auf alle Controls, `role="dialog"`, Fokus rein/raus, `⌘+Enter` (F9).
5. „nur diese PR" standardmäßig an, Sendemodus nur bei laufendem Thread, Env-Select nur bei >1 (F5, Teil).
6. Kommentar-Button mit Icon und Primer-Look; Header-Fallback nicht schwebend (F8).
7. Stale-Paint des Primär-Buttons beheben (F10). Texte (F13).
8. Vorlagen: `link_pull_request`/Review-Guide-Zeile voranstellen; `{{pr.description}}`, strukturierte Kommentarfelder (F6).

### Phase 2 — Aktion + Antworten (3–5 Tage, M)

1. Split-Button im Header mit kontextabhängiger Primäraktion und 5-s-Abbruch-Toast (F1, F14).
2. Job-Karte mit Antwortfeld (`t3_thread_send`), Stop (`t3_thread_interrupt`), Pending-Request-Anzeige (`t3_pending_request`) (F2).
3. Ziel-Combobox mit Gruppen; Composer-Layout „Textfeld zuerst, Ziel eine Zeile, Erweitert" (F5, F10).
4. Review-Vorlage mit Schalter „Inline-Kommentare / Nur Bericht" und „postet als …"-Hinweis (F6).
5. Polling auf 5 s bei offenem Panel/Popup (F7).
6. Erstlauf-Wizard im Popup; Pairing aus dem Optionen-Hauptpfad heraus (F4, F12).

### Phase 3 — Agent-Box und Inbox (1–2 Wochen, L)

1. Inline-Agent-Box unter dem PR-Header; Drawer nur noch für „Anpassen…" (Zieldesign 4.2).
2. Popup als Inbox mit Antwortfeld (F11).
3. Kontext-Signale: Checks rot / Changes requested / Draft → Primäraktion und Vorschläge; Branch-Konfliktwarnung (F14).
4. Vorlagen-Editor mit Live-Vorschau gegen Beispiel-PR, Platzhalter-Chips, Kommentar-Aktionen pro Vorlage konfigurierbar (F12).
5. Optional: Diff-Textauswahl-Floating-Aktion „An T3"; Kurzantworten aus Agentenfragen; Watch-Integration (`watch_pull_request`) für Sessions, die auf neue Kommentare reagieren sollen.

---

## Anhang: Screenshot-Index

| Datei | Zustand |
|---|---|
| `test/e2e/out/01-options-connected.png` | Optionen, gekoppelt |
| `test/e2e/out/02-popup.png` | Popup ohne Sessions |
| `test/e2e/out/03-pr-with-trigger.png` | PR-Seite, Trigger als Floating-Fallback |
| `test/e2e/out/04-panel-new-session.png` | Panel, Neue Session (Standardansicht) |
| `test/e2e/out/05-panel-existing-session.png` | Panel, Bestehende Session mit PR-Link |
| `test/e2e/out/07-completed.png` | Panel nach Dispatch, Job fertig |
| `test/e2e/out/review/11-trigger-zoom.png` | Trigger mit Warte-Punkt und Zähler |
| `test/e2e/out/review/12-comment-button-zoom.png` | Kommentar-Button „T3" |
| `test/e2e/out/review/13-panel-with-joblist.png` | Panel mit laufender und wartender Session |
| `test/e2e/out/review/14-panel-details-and-preview-open.png` | Details und Prompt-Vorschau offen |
| `test/e2e/out/review/15-panel-existing-all.png` | Alle 136 Sessions |
| `test/e2e/out/review/16-panel-existing-filter.png` | Session-Filter „pondus" |
| `test/e2e/out/review/17-panel-reply-to-comment.png` | Kommentar-Aktion mit Zitat |
| `test/e2e/out/review/18-focus-chip.png` | Fehlender Fokusring auf Chip |
| `test/e2e/out/review/19-narrow-1000.png`, `20-narrow-760.png` | Schmale Viewports |
| `test/e2e/out/review/21-files-tab.png` | Files-Tab, keine Kommentar-Buttons |
| `test/e2e/out/review/22-popup-with-jobs.png`, `23-popup-dark.png` | Popup mit Sessions, hell/dunkel |
| `test/e2e/out/review/24-…27-….png` | Optionen: Vorlagen, Editor, Einstellungen, Dark |
| `test/e2e/out/review/30-popup-unpaired.png` | Popup, nicht gekoppelt |
| `test/e2e/out/review/31-…34-….png` | Erstlauf, unerreichbarer Server, ungekoppelt, Pairing-Fehler |
| `test/e2e/out/review/35-panel-not-paired.png` | Panel ungekoppelt, irreführende Meldung |
| `test/e2e/out/review/37-btn-a/b/c.png` | Stale Paint des Primär-Buttons |
