# Plan: PR-Übersicht in Panels auf `/pulls`

Stand: 2026-11-03 · Status: MVP umgesetzt (AP1–AP7), eingeloggte Verifikation (AP0) offen · Autor: UX-/Software-Engineering-Plan für Julian

Die Extension soll auf der PR-Listenseite eines Repositories (`https://<host>/<owner>/<repo>/pulls`) die offenen
Pull Requests in Panels gliedern („Meine Pull Requests“, „Review angefragt“) und jeder Zeile Quick-Actions geben,
die die bestehenden Aktionen (Review starten, CI fixen, Kommentare abarbeiten, Zusammenfassen, Anpassen…) sowie
„Session öffnen“ für bereits verknüpfte T3-Sessions anbieten.

---

## Umsetzungsstand (2026-11-03)

- **Umgesetzt:** AP1–AP7. Code in `src/shared/pulls.ts`, `src/content/github/pullsPage.ts`, `src/content/ui/pullsStore.ts`, `src/content/ui/PullsPanels.tsx`; Worker-Nachricht `prs.sessions`; Einstellung `pullsPanelsEnabled` (flach statt `pullsPanels.enabled`).
- **Abweichung Branch-Ermittlung:** Die PR-Seite ist inzwischen ebenfalls eine React-App ohne `.head-ref`. Der Branch kommt aus ihrem eingebetteten JSON (`pullRequestsLayoutRoute.pullRequest.headBranch`, ✅ per `curl` geprüft); `.head-ref` bleibt nur Fallback. `readPrContext` wurde deshalb nicht auf `root` umgebaut.
- **Verifiziert (ausgeloggt, Showcase):** Parser gegen echte Seiten, Montage vor `react-app`, Content-Script-Fetches, Session-Badges, Countdown mit PR-Nummer, Dark Mode, 760 px.
- **Nachgereicht: gestapelte PRs.** PR B gilt als auf A gestapelt, wenn B in As Head-Branch mergt und dieser im selben Repo liegt. Die Branches kommen aus dem PR-Hovercard (`/pull/<n>/hovercard`, ~5 KB, ✅ per `curl` geprüft), höchstens 4 parallel, 5 min gecacht; derselbe Cache liefert den Branch für Worktrees. Stacks sind standardmäßig zugeklappt („Stack · n PRs“), aufgeklappt folgen die PRs eingerückt mit „baut auf #n auf“. Gruppiert wird nur innerhalb eines Panels.
- **Fix nach erstem Login-Test:** Bei null Treffern lässt GitHub `results` und `totalCount` im JSON weg; der Parser behandelt das als leere Liste.
- **Offen (AP0, braucht Login):** `@me`-Suchen mit echter Sitzung, Rate-Limit-Verhalten, klassische GHES-Liste.

## 0. Die wichtigsten Entscheidungen auf einen Blick

| Thema | Entscheidung | Warum |
|---|---|---|
| Panels | **P1 „Meine Pull Requests“** (`author:@me` ∪ `assignee:@me`), **P2 „Review angefragt“** (`review-requested:@me`). Kein drittes Panel im MVP; GitHubs eigene Liste darunter bleibt die „Übrigen“. Optionales P3 „Übrige“ + Ausblenden der GitHub-Liste als V2-Setting. | Keine Duplikation der Liste, keine Verantwortung für Paginierung/Filter von GitHub, klare Semantik. |
| Datenquelle | **Drei same-origin-Fetches** der `/pulls?q=…`-Seite aus dem Content-Script, geparst aus dem SSR-JSON `script[data-target="react-app.embeddedData"]`; DOM-Parser der sichtbaren Liste nur als Fallback (klassische GHES-Liste, SSR-JSON fehlt). | Unabhängig von dem Filter, den der Nutzer gerade sieht; strukturierte Daten statt CSS-Klassen-Hashes; kein GitHub-Token nötig. |
| Nutzererkennung | `meta[name="user-login"]` (existiert auch ausgeloggt, dann leer → Feature aus). | Bereits in `src/content/github/prContext.ts:126` genutzt. |
| Montage | **Additiv über GitHubs Liste**, als Geschwister vor `<react-app app-name="repo">` im `#repo-content-turbo-frame`, Shadow-DOM-Host wie die Agent-Box; einklappbar, Zustand gespeichert. | React-Root nicht anfassen (würde beim Reconcile entfernt), Turbo-Frame-Scope räumt beim Repo-Wechsel auf. |
| Quick-Actions | Pro Zeile ein kompakter Split-Button wie im PR-Header (`t3-split`): **primär „Session öffnen“** bei aktiver Session, sonst **vorgeschlagene Aktion** per `suggestIntent`; Menü mit allen Aktionen, „Anpassen…“ (Composer) und Session-Liste. Countdown-Toast wird wiederverwendet. | Gelerntes Muster von der PR-Seite, eine Interaktion statt dreier. |
| Branch für Worktree | Die Liste kennt keinen Head-Branch. Beim Klick auf eine Aktion **lazy** die PR-Seite same-origin laden und mit `readPrContext` (refaktoriert auf `root: ParentNode`) auslesen; Fallback Projekt-Checkout. | Nur Kosten bei Nutzung, volle Kontextqualität (Branch, Checks, Review-Decision) für Templates. |
| Session-Zuordnung | **Eine** neue Worker-Nachricht `prs.sessions` mit N PR-Keys → ein `t3_thread_list` pro Environment (bereits gecacht, `src/background/catalog.ts:215`) + Jobs aus `chrome.storage`; kein `t3_thread_read` pro PR. | O(1) MCP-Calls statt O(N). |
| Einstellungen | `pullsPanels.enabled` (Default an), V2: `pullsPanels.showOthers`, `pullsPanels.hideGithubList`. Einklapp-Zustand pro Browser in `chrome.storage.local`. | Minimal, abschaltbar, kein Konfigurationsdschungel. |

---

## 1. Ausgangslage im Code

Was existiert und wiederverwendet wird (Pfad:Zeile):

- **Seitenerkennung**: `src/content/github/prDetector.ts:10` (`watchPrLocation`) hängt an Turbo/PJAX/`history.*` und einem 1,5-s-Intervall; `src/shared/prKey.ts:65` (`parsePrUrl`) kennt nur `/pull/<n>`.
- **Lifecycle & Mounts**: `src/content/index.ts:139` (`mountAll`), `:155` (`activate` mit `MutationObserver` auf `document.body`, 250 ms Debounce), `:177` (`deactivate`); Shadow-Hosts via `makeHost` (`:33`). Selektoren zentral in `src/content/github/mountPoints.ts`.
- **PR-Kontext aus dem DOM**: `src/content/github/prContext.ts:99` (`readPrContext`) liest Titel, Branches, Autor, Viewer (`meta[name='user-login']`, `:126`), Draft, Review-Decision, Checks – aber nur gegen das globale `document`.
- **Store (Signals)**: `src/content/ui/store.ts` – `pr` (`:48`), `load` (`:136`), `quickDispatch` (`:449`, Countdown-Toast), `dispatch` (`:394`, optimistische Session), `openComposer` (`:319`), `openInT3` (`:606`), `defaultTarget` (`:227`, Worktree nur mit `headBranch`).
- **UI-Bausteine**: `src/content/ui/HeaderAction.tsx` (Split-Button + Menü, Status-Chip), `src/content/ui/AgentBox.tsx` (Session-Karten), `src/content/ui/components.tsx` (`StatusChip`, `StatusDot`, `relativeTime`, `Icon`), `src/content/ui/styles.ts` (Primer-Variablen, `.t3-split`, `.t3-menu`, `.t3-box`).
- **Aktionen/Intents**: `src/shared/intent.ts:7` (`suggestIntent`), `src/shared/templates/builtin.ts` (sechs Built-ins), `src/shared/templates/render.ts`.
- **Worker**: `src/background/router.ts:113` (`pr.overview`), `:171` (`pr.sessions`), `:175` (`pr.dispatch`); `src/background/sessions.ts:200` (`sessionsForPr`: Jobs + verlinkte Threads, aber mit bis zu 6 `readThread`-Calls); `src/background/catalog.ts:215` (`listThreads`, TTL 45 s, bis zu 300 Threads); `src/shared/sort.ts:32` (`threadIsLinked`: `pullRequests[]` oder Titel-Match).
- **Hosts**: `src/background/githubHosts.ts` registriert `content-standalone.js` für GHES; `broadcast` in `src/background/index.ts:17` erreicht alle GitHub-Tabs (nicht nur PR-Seiten) – Events kommen also auch auf `/pulls` an.
- **Einstellungen**: `src/shared/models.ts:288` (`ExtensionSettings`), `src/shared/messages.ts:102` (zod-Schema), `src/options/Options.tsx:616` (Settings-Tab).
- **Tests**: Vitest mit `environment: "node"` (`vite.config.ts:29`); `jsdom` ist in den devDependencies, wird aber noch nicht benutzt. E2E/Showcase: `test/e2e/showcase.mjs` mit `test/e2e/fakeT3.mjs` (Demo-Threads sind an `flaaaps/pondus#5` gebunden).

---

## 2. Recherche: Wie GitHub `/pulls` heute rendert

Verifiziert am 2026-11-03 per `curl` auf `https://github.com/preactjs/preact/pulls` (ausgeloggt, github.com). Markierungen: ✅ verifiziert, ⚠️ eingeloggt/GHES zu verifizieren (Spike, AP0).

**Die Seite ist eine React-App mit SSR** ✅
- `<meta name="react-app-name" content="pull-requests">`, `<meta name="route-controller" content="repo_pulls_dashboard">`, `<meta name="route-pattern" content="/:user_id/:repository/pulls(.:format)">`.
- Markup: `<turbo-frame id="repo-content-turbo-frame"> … <react-app app-name="repo" initial-path="/preactjs/preact/pulls" data-ssr="true" data-data-router-enabled="true"> <div data-target="react-app.reactRoot">…`.
- Die Liste: `[data-listview-component="items-list"][role="list"][aria-busy]` mit `<li id="…-list-view-node-…">`-Zeilen; Titel-Link `a[data-testid="listitem-title-link"][href="https://github.com/o/r/pull/N"]`, Autor `a[data-testid="author-filter-link"]` (`aria-label="Filter by author <login>"`), Zeitstempel `relative-time`, Nummer als Text `#5348`. Alle anderen Klassen sind gehashte CSS-Module (`listItem__X41oTe`) → **nicht** benutzen.
- Review-Status und Checks-Status werden **deferred** geladen: beim SSR stehen dort `[data-testid="deferred-review-skeleton"]` und `[data-testid="deferred-status-skeleton"]`; die echten Elemente erscheinen erst clientseitig (⚠️ Markup der geladenen Elemente eingeloggt prüfen; vermutlich ein Link/Octicon mit `aria-label` wie „2 / 3 checks OK“ und ein Review-Octicon mit `aria-label="Review required|Approved|Changes requested"`).

**Strukturierte Daten liegen im SSR-JSON** ✅
`<script type="application/json" data-target="react-app.embeddedData">` →
`payload.repoPullsDashboardContentRoute = { results[], currentPage, totalPages, totalCount, openCount, closedCount }`
mit pro Eintrag: `number`, `title`, `titleHtml.value`, `permalink`, `repoNameWithOwner`, `author.displayLogin`, `author.association`, `state` (`REPO_PULL_REQUEST_STATE_OPEN`), `displayState`, `isDraft` (nur wenn true), `labels` (optional), `createdAt`, `updatedAt`, `commentCount`, `headSha`, `linkedIssueCount`, `taskListItemCount`. **Nicht enthalten**: Head-/Base-Branch, Reviewer, Assignees, Checks-Status, Review-Decision.

**Filter & Navigation** ✅
- Suchfeld `input#repo-pulls-dashboard-filter-input` mit `value="is:pr state:open"` (neue Syntax `state:open`, nicht `is:open`), URL-Parameter `?q=…`, Seiten `?page=N` (`totalPages` im JSON; Pagination-Markup bei 1 Seite nicht vorhanden).
- Qualifier für die Panels: `author:@me`, `assignee:@me`, `review-requested:@me` (umfasst Team-Anfragen; `user-review-requested:@me` nur direkte), optional `sort:updated-desc`, `draft:false`, `review:changes_requested`.
- Navigation innerhalb der React-App (Filter ändern, Seite wechseln) läuft über den **React Data Router** (`pushState`), nicht über Turbo. Das `embeddedData`-Script bleibt dann **veraltet** – die DOM-Liste wird aber neu gerendert. Repo-Wechsel geht über Turbo (`turbo-frame` ersetzt Inhalt).
- `<meta name="user-login" content="">` existiert ausgeloggt mit leerem Wert ✅; eingeloggt enthält es den Login (⚠️ zu bestätigen, bekanntes GitHub-Verhalten, wird schon in `prContext.ts:126` genutzt).

**Unsicher / zu verifizieren (AP0 Spike)** ⚠️
1. Liefert ein `fetch("/o/r/pulls?q=…", { credentials: "same-origin", headers: { accept: "text/html" } })` aus dem Content-Script dieselbe SSR-Seite inklusive `embeddedData`? (Erwartung: ja, `data-attempted-ssr="true"`; GitHub könnte bei `X-Requested-With`/Turbo-Headern Fragmente liefern – diese Header nicht setzen.)
2. Wie sehen die geladenen Review-/Checks-Elemente im Listen-DOM aus (Selektoren für das V2-„DOM-Sync“)?
3. GitHub Enterprise Server: ältere Versionen (≤ 3.15?) rendern die **klassische Liste** (`.js-issue-row#issue_<n>`, `a.js-navigation-open[data-hovercard-type="pull_request"]`, `.opened-by`, `.commit-build-statuses`, `.IssueLabel`, `span.State--draft`). Der klassische Parser bleibt deshalb als Fallback im Plan, kann aber ohne GHES-Zugang nur gegen eine handgeschriebene Fixture getestet werden.
4. Rate-Limits/Abuse-Detection bei drei HTML-Fetches pro Seitenaufruf (300 KB je Antwort): Mit 60-s-Cache pro Repo und Query sollte das unkritisch sein; im Spike 20 Aufrufe hintereinander prüfen.

---

## 3. Informationsarchitektur (UX)

### 3.1 Semantik der Panels

Julians Formulierung „auf die ich assigned bin“ ist zweideutig. GitHub kennt drei Rollen, die unterschiedliche Handlungen auslösen:

| Rolle | Query | Was ich damit tue | Panel |
|---|---|---|---|
| Autor | `author:@me` | Ich treibe den PR: CI fixen, Kommentare abarbeiten, mergen | **P1 „Meine Pull Requests“** |
| Assignee | `assignee:@me` | Ich bin verantwortlich, meist ohne Autor zu sein (Übernahme, Pairing) | **P1**, mit Badge „zugewiesen“, wenn ich nicht Autor bin |
| Reviewer angefragt | `review-requested:@me` | Andere warten auf mich: Review starten, zusammenfassen | **P2 „Review angefragt“** |

Entscheidungen:
- **P1 = Autor ∪ Assignee.** Beides heißt „mein Ball“; die Aktionen (CI fixen, Kommentare abarbeiten) sind identisch. Ein PR, der in beiden Mengen ist, erscheint einmal.
- **P2 = Review angefragt.** Ein PR, der in P1 *und* P2 wäre (selbst angefragt – selten), landet nur in P1; P2 zeigt dann ein kleines „auch Review angefragt“-Badge nicht, um Rauschen zu vermeiden.
- **Kein P3 im MVP.** GitHubs Liste darunter zeigt bereits alles; ein drittes Panel „Übrige“ würde dieselben Zeilen verdoppeln. V2 (Setting `pullsPanels.showOthers`): P3 „Übrige offene“ = sichtbare GitHub-Liste minus P1/P2, zusätzlich Setting „GitHub-Liste ausblenden“.
- **Reihenfolge: „Review angefragt“ zuerst, dann „Meine Pull Requests“** (entschieden 2026-11-03, Q1). Inbox-Logik wie im Popup: andere warten auf mich zuerst. Die Bezeichner P1/P2 im Plan bleiben wie definiert (P1 = Meine, P2 = Review angefragt); gemeint ist nur die Anzeige-Reihenfolge P2 → P1.
- **Nur offene PRs** (`state:open`). Geschlossene/gemergte tauchen nicht auf; wenn der Nutzer in GitHub `state:closed` filtert, bleiben die Panels unverändert (sie sind filterunabhängig) – das ist bewusst und wird im Panel-Kopf nicht extra erklärt.
- **Sortierung** innerhalb eines Panels: 1) PRs mit Session im Zustand `waiting` (Agent wartet auf mich), 2) mit laufender Session, 3) Rest nach `updatedAt` absteigend. Drafts werden nicht nach unten sortiert, aber gekennzeichnet.

### 3.2 Befüllung der Panels

Drei Datenquellen wurden erwogen:

| Quelle | Pro | Contra | Entscheidung |
|---|---|---|---|
| **A. Gerenderte GitHub-Liste (DOM)** | keine Requests | zeigt nur den aktuellen Filter/Seite; Review-/Assignee-Rolle nicht erkennbar; Klassen gehasht | Fallback für Zeilen-Sync (V2) und GHES-Klassik |
| **B. GitHub REST/GraphQL ohne Token** | strukturiert | keine privaten Repos, 60 Req/h, CORS/Token-Fragen – widerspricht „kein GitHub-Token“ (README) | verworfen |
| **C. Mehrere `/pulls?q=`-Seiten same-origin fetchen und `embeddedData` parsen** | nutzt die Session-Cookies des Nutzers, funktioniert für private Repos und GHES, strukturierte Felder, filterunabhängig | 3 HTML-Antworten à ~300 KB; Abhängigkeit vom `embeddedData`-Format | **gewählt** |

Ablauf pro Seitenaufruf (`PullsPage` aktiv, Viewer bekannt):
1. `GET /{owner}/{repo}/pulls?q=is:pr state:open author:@me sort:updated-desc`
2. `GET …?q=is:pr state:open assignee:@me sort:updated-desc`
3. `GET …?q=is:pr state:open review-requested:@me sort:updated-desc`
   – parallel, `credentials: "same-origin"`, `Accept: text/html`, kein `Turbo-Frame`/`X-Requested-With`-Header.
4. `parsePullsHtml(html)` → `PullsPageData { results: PrListItem[], currentPage, totalPages, totalCount }` aus `embeddedData`; wenn das Script fehlt (GHES-Klassik) → `parsePullsClassicDom(doc)`.
5. Pagination: Pro Query nur Seite 1 (25 Einträge) im MVP. Wenn `totalPages > 1`, zeigt das Panel „+ N weitere auf GitHub“ als Link mit demselben `q`. Begründung: >25 eigene offene PRs in einem Repo sind die Ausnahme; eine zweite Seite nachzuladen ist als Erweiterung (AP8) vorgesehen (Cap 50).
6. `assignPanels(author, assignee, reviewRequested, viewer)` → `{ mine: PrListItem[], review: PrListItem[] }` mit Dedupe und Rollen-Flags (`roles: Set<"author"|"assignee"|"review-requested">`).
7. `prs.sessions`-Request an den Worker mit allen PR-Keys → Session-Badges.
8. Cache: Antworten 60 s pro `host/owner/repo/q` im Content-Script (Modul-Variable); `sessions.updated`-Events aktualisieren nur die Badges. Ein „Aktualisieren“-Button im Panel-Kopf erzwingt alles neu.

Der Nutzer wird aus `meta[name="user-login"]` gelesen (Helper `readViewer()` in `prContext.ts`, bereits implizit vorhanden). Leer → Panels nicht montieren (ausgeloggte Nutzer sehen nichts; die Aktionen brauchen ohnehin ein gekoppeltes T3). `@me` in den Queries vermeidet, den Login in die URL zu schreiben, und funktioniert identisch auf GHES.

GitHub Enterprise: alle Fetches sind **relative URLs** auf dem aktuellen Origin; `PrKey.host` kommt aus `window.location.hostname` (normalisiert wie in `parsePrUrl`). Für `*.ghe.com` und registrierte GHES-Hosts läuft der Content-Script bereits (`src/background/githubHosts.ts:25`), es ist keine zusätzliche Host-Permission nötig. `meta[name="user-login"]` existiert auf GHES ebenso.

---

## 4. Darstellung

### 4.1 Wo

Der Panel-Host wird **oberhalb** von GitHubs Liste eingefügt: als Geschwister direkt vor `react-app[app-name="repo"]` innerhalb `#repo-content-turbo-frame`. Vorteile: Turbo ersetzt beim Repo-Wechsel den Frame-Inhalt (Host verschwindet automatisch), React fasst Geschwister seines Root-Elements nicht an. Fallbacks (Reihenfolge): `#repo-content-pjax-container` (ältere GHES) → vor `.repository-content` → vor `main`.

GitHubs Liste bleibt sichtbar und unverändert (Filter, Paginierung, Tastaturkürzel von GitHub funktionieren weiter). Die Panels sind gemeinsam einklappbar (Kopfzeile „T3 Code · Meine PRs 3 · Review angefragt 2 · [Einklappen]“); eingeklappt bleibt nur die Kopfzeile mit Zählern. Der Zustand wird in `chrome.storage.local` (`pullsPanelsCollapsed`) gespeichert.

Kein Umschaltmodus im MVP; „GitHub-Liste ausblenden“ ist V2 (Setting), technisch `[data-listview-component="items-list"]` plus Pagination per `style.display="none"` aus dem Content-Script mit MutationObserver-Reapply – fragil, daher nicht als Default.

### 4.2 Was pro Zeile

Verfügbar ohne Zusatz-Request (aus `embeddedData`): Status-Icon (offen/Draft), Titel, `#Nummer`, Autor-Login, Labels (Name/Farbe, falls geliefert), Kommentarzahl, „aktualisiert vor …“. Rolle (Badge „zugewiesen“ in P1, wenn nur Assignee). T3-Status-Badge aus `prs.sessions` (`StatusChip`: „läuft“, „wartet auf dich“, „fertig · vor 2 h“, bei mehreren Sessions „2 Sessions · 1 wartet“).

Nicht verfügbar im MVP: Branch, Checks-Status, Review-Decision (deferred/nur auf der PR-Seite). V2 „DOM-Sync“: Die Panels beobachten GitHubs eigene Liste; sobald dort für eine Nummer das Checks-/Review-Element erscheint, wird dessen `aria-label` übernommen (Mapping über die PR-URL im Titel-Link). Das funktioniert nur für PRs, die auch in GitHubs aktueller Liste stehen – für P1/P2 in der Regel der Fall (Default-Filter `state:open`).

### 4.3 Wireframes (ASCII)

Desktop, beide Panels, eingeloggt, T3 verbunden:

```
┌─ #repo-content-turbo-frame ───────────────────────────────────────────────────────────────┐
│ [Filters ▾] [ is:pr state:open                       ] [Labels 42] [Milestones] [New PR]  │
│                                                                                           │
│ ╔═ t3-pulls (Shadow DOM) ════════════════════════════════════════════════════════════════╗ │
│ ║ [T3] T3 Code   ● 1 wartet  ● 1 läuft                           [↻ Aktualisieren] [Einklappen] ║ │
│ ╟──────────────────────────────────────────────────────────────────────────────────────╢ │
│ ║ MEINE PULL REQUESTS (3)                                                               ║ │
│ ║ ┌────────────────────────────────────────────────────────────────────────────────────┐ ║ │
│ ║ │ ⑂  Rate-Limit für Exporte                         #42  jane · vor 2 h · 💬 3       │ ║ │
│ ║ │    [bug] [api]        ● wartet auf dich · „Findings posten oder Tests ergänzen?“   │ ║ │
│ ║ │                                              [▶ Session öffnen | ▾]               │ ║ │
│ ║ ├────────────────────────────────────────────────────────────────────────────────────┤ ║ │
│ ║ │ ⑂  Offline-Outbox beim Beenden flushen            #40  jane · vor 1 d · 💬 0       │ ║ │
│ ║ │    [zugewiesen]                                                                    │ ║ │
│ ║ │                                              [▶ Review starten | ▾]               │ ║ │
│ ║ ├────────────────────────────────────────────────────────────────────────────────────┤ ║ │
│ ║ │ ◌  Draft: Live Activities Spike                   #38  jane · vor 3 d · 💬 1       │ ║ │
│ ║ │                                              [▶ Zusammenfassen | ▾]               │ ║ │
│ ║ └────────────────────────────────────────────────────────────────────────────────────┘ ║ │
│ ║                                                                                        ║ │
│ ║ REVIEW ANGEFRAGT (2)                                            + 3 weitere auf GitHub ║ │
│ ║ ┌────────────────────────────────────────────────────────────────────────────────────┐ ║ │
│ ║ │ ⑂  Dark Mode für das Dashboard                    #41  tom · vor 20 min · 💬 2     │ ║ │
│ ║ │    [ui]                                ● läuft · Review: Dark Mode … (Sonnet)     │ ║ │
│ ║ │                                              [▶ Session öffnen | ▾]               │ ║ │
│ ║ ├────────────────────────────────────────────────────────────────────────────────────┤ ║ │
│ ║ │ ⑂  Tests für den Outbox-Flush                     #39  ana · vor 4 h · 💬 0        │ ║ │
│ ║ │                                              [▶ Review starten | ▾]               │ ║ │
│ ║ └────────────────────────────────────────────────────────────────────────────────────┘ ║ │
│ ╚════════════════════════════════════════════════════════════════════════════════════════╝ │
│                                                                                           │
│ ┌─ GitHubs eigene Liste (unverändert) ──────────────────────────────────────────────────┐  │
│ │ ○ Open 24   ✓ Closed 2,987                                   Author ▾ Label ▾ Sort ▾ │  │
│ │ ⑂  Rate-Limit für Exporte  #42 · jane opened 2 hours ago · ✓ 3/3 · Review required   │  │
│ │ …                                                                                    │  │
│ └──────────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

Zeilen-Menü (▾) geöffnet, PR mit aktiver Session:

```
                                              [▶ Session öffnen | ▾]
                                              ┌───────────────────────────────────────┐
                                              │ Sessions zu #42                        │
                                              │  ● wartet  Review: Rate-Limit …   →    │
                                              │  ● fertig  PR zusammenfassen      →    │
                                              ├───────────────────────────────────────┤
                                              │ Review starten                         │
                                              │ Kommentare abarbeiten                  │
                                              │ CI fixen                               │
                                              │ Zusammenfassen                         │
                                              │ Freier Prompt                          │
                                              ├───────────────────────────────────────┤
                                              │ Anpassen…                     ⌥⇧T    │
                                              │ Ziel: Neu in Pondus · Worktree (Branch │
                                              │       wird beim Start ermittelt)       │
                                              └───────────────────────────────────────┘
```

Schmal (< 768 px): Aktionen rücken unter die Metadaten, der Split-Button wird zum reinen Icon-Button `[T3 ▾]` (Primär-Aktion ist erster Menüeintrag, fett):

```
┌──────────────────────────────────────────┐
│ ⑂ Rate-Limit für Exporte        [T3 ▾]  │
│   #42 · jane · vor 2 h · ● wartet       │
└──────────────────────────────────────────┘
```

### 4.4 Zustände

| Zustand | Darstellung |
|---|---|
| Ausgeloggt (`user-login` leer) | Nichts montieren. |
| Laden (Fetches laufen) | Kopfzeile sofort („T3 Code · lädt…“ mit `Spinner`), darunter zwei Panel-Überschriften mit je 2 Skeleton-Zeilen (`.t3-skel`, Puls-Animation `t3-pulse`). Max. 1 s wahrgenommene Wartezeit angestrebt. |
| Leer P1/P2 | Panel-Überschrift bleibt, darunter eine ruhige Zeile: „Keine offenen Pull Requests von dir.“ / „Niemand wartet auf dein Review.“ Beide leer → Panels zeigen nur die zwei Leerzeilen, Kopfzeile bietet „Einklappen“. Nicht automatisch ausblenden (sonst wirkt das Feature kaputt). |
| GitHub-Fetch fehlgeschlagen (HTTP ≠ 200, Parser findet nichts) | Panel-Körper durch `Alert`: „GitHub-Liste konnte nicht gelesen werden.“ + „Erneut versuchen“. Einmal pro Session zusätzlich `console.warn` mit Parser-Diagnose (welcher Selektor fehlte). |
| T3 nicht erreichbar/ungekoppelt | Panels **trotzdem** mit GitHub-Daten anzeigen (die Gliederung ist auch ohne T3 nützlich). Statt Session-Badges ein dezenter Hinweis in der Kopfzeile: „T3 Code offline · erneut prüfen“ bzw. „T3 Code einrichten“ (öffnet Composer-Pairing wie `HeaderAction.tsx:49`). Split-Buttons zeigen „T3 Code“ deaktiviert mit Tooltip; Menü nur „Einrichten…“. |
| Aktion läuft (Klick) | Primär-Button zeigt `Spinner` + „Lade PR…“ während der Branch-Ermittlung (≈ 300–800 ms), dann Countdown-Toast unten rechts (`Toast.tsx`), die Zeile erhält sofort eine optimistische Badge „startet“. |
| Fehler beim Dispatch | Fehler-Toast (12 s) wie `store.ts:493`. |
| Dark Mode | Alle Farben aus Primer-Variablen (`styles.ts:1-24`), keine neuen Hardcodes; Label-Farben aus GitHub (`labels[].color`) werden wie GitHub mit `--label-r/g/b` und Kontrastformel gerendert (Primer-`IssueLabel`-Logik nachbauen, nur MVP-einfach: Hintergrund `#rrggbb1a`, Rahmen `#rrggbb66`, Text `#rrggbb` in Light, in Dark leicht aufgehellt). |

### 4.5 Keyboard & A11y

- Host-Container `role="region"` mit `aria-label="T3 Code: Pull-Request-Übersicht"`; Panels als `<section aria-labelledby>`; Zeilenliste `role="list"`/`role="listitem"`.
- Tab-Reihenfolge pro Zeile: Titel-Link → Primär-Button → Menü-Button. Menü wie `HeaderAction.tsx:17-32`: `aria-haspopup="menu"`, `aria-expanded`, Esc schließt, Klick außerhalb schließt; zusätzlich ↑/↓ zwischen `role="menuitem"` (neu, kleine Helper-Funktion, auch für HeaderAction nachrüstbar).
- Keine Vereinnahmung von GitHubs `j/k/o`-Kürzeln; kein globaler Shortcut im MVP (Q4: optional `Alt+Shift+T` öffnet auf `/pulls` den Composer für die zuletzt fokussierte Zeile).
- Statusbadges tragen Text, nicht nur Farbe (`StatusChip` bringt Label mit).
- Fokus kehrt nach Toast/Composer auf den auslösenden Button zurück (`returnFocusTo` existiert in `Composer`; Panels übergeben den jeweiligen Button).

---

## 5. Quick-Actions

### 5.1 Priorität und Primär-Aktion

Regel (Funktion `primaryActionFor(item, sessions, templates)` in `src/shared/intent.ts`, testbar):
1. Aktive Session (`isActiveStatus`) vorhanden → **„Session öffnen“** (`thread.open`); bei `waiting` Label „Antworten“ und Öffnen der Session in T3 (Inline-Antwort in der Liste ist V2, siehe Q3).
2. Sonst `suggestIntent(prContext, templates)` mit dem, was die Liste weiß: `isDraft` → „Zusammenfassen“; `viewer === author` und (V2-DOM-Sync) „Changes requested“ → „Kommentare abarbeiten“; Checks rot (V2) → „CI fixen“; sonst → „Review starten“. In P1 ohne Zusatzinfos ist „Review starten“ für eigene PRs semantisch schwach – daher in P1 Default **„Zusammenfassen“**, wenn nichts Besseres bekannt ist (eigene PRs reviewt man selten selbst); in P2 Default „Review starten“. Das ist eine kleine Erweiterung von `suggestIntent` um den Parameter `role`.
3. Fertige Session, keine aktive → Primär bleibt die Intent-Aktion, Menü zeigt die Session unter „Sessions zu #N“ mit „Weiterarbeiten“ (Composer, Target `session`).

### 5.2 Interaktionsmuster

- **Split-Button** (`.t3-split`, Variante `.small`) rechts in der Zeile, immer sichtbar (nicht hover-only: Touch, Tastatur, Entdeckbarkeit). Grün (`primary`) nur wenn T3 bereit ist; sonst neutral.
- **Menü** = bestehendes `.t3-menu`-Markup: Abschnitt „Sessions zu #N“ (nur wenn vorhanden; Klick öffnet in T3), dann alle Templates mit `intentReason`-Hinweisen, Trennlinie, „Anpassen…“, Ziel-Zeile.
- **Ein-Klick** → `store.quickDispatch(intentId)` mit Countdown-Toast (`dispatchDelaySeconds`), „Abbrechen“/„Anpassen“ wie bisher. Da auf `/pulls` mehrere PRs im Spiel sind, trägt der Toast-Detailtext zusätzlich `#N Titel`.
- **„Anpassen…“** → `store.openComposer({ intentId })` – der Composer-Drawer wird auch auf `/pulls` montiert (`mountOverlay`). Kleine Ergänzung in `Composer.tsx:74`: unter dem Titel eine Zeile „#42 Rate-Limit für Exporte“ mit Link, damit klar ist, für welchen PR geschrieben wird.
- **Mehrere Aktionen parallel**: Jede Zeile kann eine Aktion starten; der Store hält aber nur einen `pr`. Deshalb wird der Dispatch **sequenziell pro Klick** aufgelöst: Klick → `activateRowContext(item)` (lädt Kontext, setzt `store.pr`, wartet `store.load`) → `quickDispatch`. Während ein Countdown läuft, sind die anderen Primär-Buttons kurz deaktiviert (Tooltip „Warte auf den laufenden Start“); das Menü bleibt bedienbar. Einfacher und ehrlicher als ein Multi-PR-Store-Umbau (siehe 8.4).

### 5.3 Kontext-Ermittlung vor dem Dispatch

`PrListItem` → `PrContext` braucht `headBranch` (Worktree-`baseRef`, `store.ts:296`) und profitiert von `checksState`/`reviewDecision`/`description` (Templates). Lösung `loadPrContext(key)` in `src/content/github/prFetch.ts`:
1. `fetch(prUrl(key), { credentials: "same-origin" })` → `new DOMParser().parseFromString(html, "text/html")`.
2. `readPrContext(location, doc)` – Refactoring von `prContext.ts`: alle `document.querySelector*` auf einen `root: ParentNode`-Parameter umstellen (Default `document`), `document.title`-Fallback nur, wenn `root === document`. Die Selektoren für die PR-Seite (`.head-ref`, `.gh-header-meta`, Merge-Box) gelten auch für die gefetchte Seite ⚠️ (SSR-Variante der neuen React-PR-Seite im Spike prüfen; Branch steht sonst auch in `embeddedData` der PR-Seite).
3. Cache 5 min pro PR-Key; Fehler → `PrContext` aus Listen-Daten ohne Branch, Ziel `root`-Checkout, Toast-Detail „Branch unbekannt – Projekt-Checkout“ und Menü-Ziel-Zeile entsprechend.

---

## 6. Einstellungen

`ExtensionSettings` (`src/shared/models.ts:288`, Schema `messages.ts:102`, Defaults `models.ts:304`):

```ts
pullsPanels: {
  enabled: boolean;          // Default true – Panels auf /pulls zeigen
  showOthers?: boolean;      // V2, Default false – drittes Panel „Übrige offene“
  hideGithubList?: boolean;  // V2, Default false – GitHubs Liste ausblenden, wenn Panels aktiv
}
```

Options → Einstellungen → neue Karte **„PR-Übersicht“** (`Options.tsx` neben `EnterpriseCard`):
- Checkbox „Pull Requests auf der Übersichtsseite in Panels gliedern (Meine · Review angefragt)“.
- V2: Checkbox „Übrige offene PRs als drittes Panel“ und „GitHubs Liste darunter ausblenden“.
- Hinweistext: „Die Panels lesen die GitHub-Seite im Browser; es wird kein GitHub-Token benötigt.“

Einklapp-Zustand (`pullsPanelsCollapsed: boolean`) liegt bewusst **nicht** in den Settings, sondern direkt in `chrome.storage.local` (UI-Zustand, kein Export). Panel-Reihenfolge ist nicht konfigurierbar (Q1 entscheidet die Default-Reihenfolge).

---

## 7. GitHub-DOM-Robustheit

- **Erkennung**: `parsePullsUrl(url)` in `src/shared/prKey.ts` → `{ host, owner, repo, query }` für Pfad `^/([^/]+)/([^/]+)/pulls/?$` (nicht `/pulls/<n>`, nicht `/issues`). `watchPrLocation` wird zu `watchLocation` verallgemeinert und liefert `{ kind: "pr", … } | { kind: "pulls", … } | undefined`; die Turbo-/`history`-Hooks (`prDetector.ts:30-44`) decken auch den React Data Router ab (`pushState`-Patch). Änderung nur des `?q=`/`?page=` bei gleichem Repo → **kein** Re-Fetch der Panels (sie sind filterunabhängig), aber Re-Mount-Check.
- **Mount-Überwachung**: Ein `MutationObserver` auf `#repo-content-turbo-frame` (Fallback `main`), `childList + subtree`, 250-ms-Debounce wie `index.ts:147`. Prüft nur `host.element.isConnected` und den Anker; bei Verlust → neu einhängen (Preact-Baum bleibt, Signals bleiben → kein Flackern, keine neuen Fetches).
- **Turbo-Cache**: `meta[name="turbo-cache-control"]=no-cache/no-preview` auf dieser Seite → kein Snapshot-Restore mit alten Hosts; trotzdem `deactivate()` beim Verlassen entfernt alle Hosts.
- **Selektoren zentral** in `src/content/github/pullsMountPoints.ts` (analog `mountPoints.ts`): `REACT_APP = 'react-app[app-name="repo"]'`, `LIST = '[data-listview-component="items-list"]'`, `ROW_TITLE = 'a[data-testid="listitem-title-link"]'`, `ROW_AUTHOR = 'a[data-testid="author-filter-link"]'`, `EMBEDDED = 'script[type="application/json"][data-target="react-app.embeddedData"]'`, `VIEWER = 'meta[name="user-login"]'`; Klassik: `.js-issue-row`, `a.js-navigation-open`, `.opened-by a`, `span.State--draft`, `.IssueLabel`.
- **Nie** gehashte CSS-Module-Klassen (`listItem__X41oTe`) verwenden.
- **Eigene Knoten ignorieren**: `OWN_HOSTS` in `prContext.ts:5` um `#t3-code-chrome-pulls` erweitern.
- **Degradation**: Wenn `embeddedData` fehlt und auch der DOM-Parser 0 Zeilen findet, obwohl die GitHub-Liste Zeilen hat (`LIST li` > 0) → Fehlerzustand (4.4) statt leerer Panels. Diagnose über `console.warn("[t3] pulls parser: …")`.

---

## 8. Architektur-Änderungen (Software)

### 8.1 Neue Dateien

| Datei | Inhalt |
|---|---|
| `src/shared/pulls.ts` | Typen `PrListItem`, `PrListRole`, `PullsPageData`, `PanelAssignment`; reine Funktionen `assignPanels`, `sortPanelItems`, `prListItemToContext`. Keine DOM-Abhängigkeit (für Worker und Tests). |
| `src/content/github/pullsPage.ts` | `parsePullsHtml(html | Document): PullsPageData` (embeddedData → Klassik-DOM-Fallback), `parsePullsClassicDom(root)`, `readViewer(root)`, `fetchPullsQuery(repo, q)` mit 60-s-Cache, `pullsQueries(viewer)`. |
| `src/content/github/pullsMountPoints.ts` | Selektoren und `findPullsAnchor()`. |
| `src/content/github/prFetch.ts` | `loadPrContext(key)` (same-origin Fetch der PR-Seite + `readPrContext(location, doc)`), Cache. |
| `src/content/ui/pullsStore.ts` | Signals: `repo`, `viewer`, `status` (`idle/loading/ready/error`), `panels` (`{ mine, review }`), `sessionsByPr: Record<string, SessionBrief[]>`, `collapsed`, `busyRow`; Aktionen `loadPanels(force)`, `refreshSessionBadges()`, `runRowAction(item, intentId)`, `openRowSession(item, session)`. Nutzt `store.ts` für Dispatch/Composer/Toast. |
| `src/content/ui/PullsPanels.tsx` | Komponenten `PullsPanels`, `Panel`, `PrRow`, `RowActions` (Split-Button + Menü), `SkeletonRow`, `LabelChip`. |
| `test/unit/pulls.test.ts`, `test/unit/pullsPage.test.ts` | siehe Abschnitt 10. |
| `test/fixtures/pulls-react.html`, `test/fixtures/pulls-classic.html`, `test/fixtures/pr-page.html` | Fixtures (gekürzt, anonymisiert). |

### 8.2 Änderungen an bestehenden Dateien

| Datei | Änderung |
|---|---|
| `src/shared/prKey.ts` | `parsePullsUrl`, `RepoKey`-Typ (`host/owner/repo`), `pullsUrl(repo, q?)`. |
| `src/content/github/prDetector.ts` | `watchLocation` mit diskriminiertem Ergebnis; `watchPrLocation` bleibt als dünner Wrapper. |
| `src/content/github/prContext.ts` | `readPrContext(location, root: ParentNode = document)`; interne `text()/checks()/branchFromRefs()` nehmen `root`; `OWN_HOSTS` erweitert. |
| `src/content/index.ts` | Zweiter Zweig im Location-Listener: `activatePulls(repo)` / `deactivatePulls()`; `mountPullsPanels()` (Host `#t3-code-chrome-pulls`, `display:block`); `mountOverlay()` auch auf `/pulls` (Composer + Toast); `sessions.updated` → zusätzlich `pullsStore.applySessionsEvent`. Keyboard-Shortcut bleibt PR-only (Q4). |
| `src/content/ui/store.ts` | `setPr` akzeptiert `{ keepComposerState?: boolean }` nicht nötig – stattdessen neue Funktion `activateContext(context, overviewForce=false): Promise<void>`, die `setPr` + `load` kapselt und auf `status === "ready"` wartet (Promise statt `pendingOpen`-Hack); `quickDispatch` liefert eine `Promise<void>` zurück, die mit dem Ende des Countdowns/Dispatch resolved (damit Zeilen ihren Busy-Zustand kennen); Toast-Detail erhält `#N Titel`. |
| `src/content/ui/Composer.tsx` | PR-Zeile im Drawer-Kopf (`#N Titel`, Link), damit auf `/pulls` der Bezug klar ist. |
| `src/content/ui/styles.ts` | Abschnitt `/* ---- pulls panels ---- */`: `.t3-pulls`, `.t3-panel`, `.t3-panel-head`, `.t3-prrow` (Grid: Icon · Inhalt · Aktionen), `.t3-label`, `.t3-skel`, Media-Query < 768 px; `.t3-split.small`. |
| `src/shared/intent.ts` | `suggestIntent(pr, templates, options?: { role?: "author"|"assignee"|"review-requested" })` und `primaryActionFor(item, sessions, templates)`. |
| `src/shared/models.ts`, `src/shared/messages.ts` | `SessionBrief`, `ExtensionSettings.pullsPanels`, Request `prs.sessions`, Response-Map-Eintrag. |
| `src/background/router.ts` | Handler `prs.sessions`. |
| `src/background/sessions.ts` | `sessionsForPrs(prs: PrKey[]): Promise<Record<string, SessionBrief[]>>` ohne `readThread`; Jobs + `catalog.listThreads` pro Environment, Matching über `threadIsLinked` (`sort.ts:32`). `knownPrs` wird für die N PRs ergänzt, damit `sessions.updated`-Events auch sie betreffen. |
| `src/background/index.ts` | nichts Zwingendes; `broadcast` erreicht `/pulls`-Tabs bereits (`githubTabPatterns`). |
| `src/options/Options.tsx` | Karte „PR-Übersicht“. |
| `vite.config.ts` | Test-Env bleibt `node`; DOM-Tests per `// @vitest-environment jsdom` im Datei-Header. |
| `README.md`, `docs/IMPLEMENTATION_PLAN.md` (Abschnitt 10 „Stand“) | Feature dokumentieren, Screenshot ergänzen. |

### 8.3 Datenmodell

```ts
// src/shared/pulls.ts
export type PrListRole = "author" | "assignee" | "review-requested";

export interface PrListItem extends PrKey {
  url: string;
  title: string;
  author?: string;
  isDraft: boolean;
  state: "open" | "closed" | "merged" | "unknown";
  labels: Array<{ name: string; color?: string }>;
  updatedAt?: string;       // ISO
  createdAt?: string;
  commentCount?: number;
  roles: PrListRole[];      // nach assignPanels gefüllt
  // V2 (DOM-Sync):
  checksState?: PrContext["checksState"];
  reviewDecision?: string;
}

export interface PullsPageData {
  repo: RepoKey;
  query: string;
  results: PrListItem[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
  source: "embedded" | "classic-dom" | "react-dom";
}

export interface PanelAssignment {
  mine: PrListItem[];
  review: PrListItem[];
  others?: PrListItem[];   // V2
}

// src/shared/models.ts
export interface SessionBrief {
  envKey: string;
  threadId: string;
  title: string;
  status: ThreadStatus;
  updatedAt: string;
  link: string;
  source: "job" | "linked";
  jobId?: string;
}
```

Nachrichten (`messages.ts`):
```ts
z.object({ type: z.literal("prs.sessions"), prs: z.array(prKeySchema).max(100) })
// Response: { sessions: Record<string /* prKeyToString */, SessionBrief[]> }
```

### 8.4 Warum kein Multi-PR-Store

`store.ts` ist um genau einen `pr` herum gebaut (Composer, Prompt-Rendering, Toast, Sessions). Ein Umbau auf „viele PRs gleichzeitig“ würde Composer, HeaderAction und AgentBox berühren. Der Plan behält daher den Single-PR-Store als **„aktiver PR“** bei und lässt `pullsStore` ihn pro Klick setzen. Das ist für Ein-Klick-Aktionen (ein Countdown zur Zeit) ausreichend und hält den Diff klein. Sollte später paralleles Antworten in mehreren Zeilen gewünscht sein (Q3), ist der nächste Schritt, `sessions`/`pr` im Store zu einem `Map<prKey, …>` zu machen.

### 8.5 Caching

| Was | Wo | TTL |
|---|---|---|
| `/pulls?q=`-Antworten | Content-Script, Modul-Map (`host/owner/repo|q`) | 60 s, „Aktualisieren“ invalidiert |
| PR-Seiten-Kontext | Content-Script, Modul-Map (`prKeyToString`) | 5 min |
| Threads/Projekte | Worker `Catalog` (bestehend) | 45 s |
| Jobs | `chrome.storage.local` (bestehend) | – |
| Einklapp-Zustand | `chrome.storage.local.pullsPanelsCollapsed` | persistent |

---

## 9. Performance

- **GitHub**: 3 parallele HTML-Fetches (~300 KB je, gzip ~40 KB) beim ersten Aufruf pro Repo und Minute; danach Cache. Parsing: `indexOf`/Regex auf das `embeddedData`-Script, `JSON.parse` (≈ 1 ms), kein DOMParser-Durchlauf nötig; DOMParser nur im Klassik-Fallback.
- **T3**: Ein `prs.sessions` pro Panel-Load mit bis zu 50 Keys. Der Worker ruft `t3_thread_list` einmal pro erreichbarem Environment (gecacht, `catalog.ts:215`, max. 3 Seiten à 100) und matcht lokal. **Kein** `t3_thread_read`/`t3_pending_request` pro PR – die Badges brauchen nur `status`/`title`/`updatedAt` aus `t3_thread_list`. Was der Server bietet: `t3_thread_list` (Filter `statuses`, `settled`, `allProjects`), `t3_thread_search` (Volltext inkl. PR, nicht erschöpfend), `list_thread_pull_requests` (pro Thread, teuer – nicht verwenden). Einen Server-seitigen Batch „Threads zu diesen N PRs“ gibt es nicht; das clientseitige Matching über `thread.pullRequests[]` (Memory: Threads tragen `pullRequests[]`) ist die vorgesehene Lösung.
- **Live-Updates**: Panels öffnen einen `live:panel`-Port (`client.ts:44`) nur, wenn mindestens eine aktive Session in den Badges ist; `sessions.updated`-Events aktualisieren die Badges lokal ohne Request (Jobs sind im Event enthalten; verlinkte Threads werden alle 60 s per `prs.sessions` nachgezogen).
- **Rendering**: Preact-Liste mit `key = prKeyToString`; Zeilen ohne eigene Effekte; Menü-Listener nur bei geöffnetem Menü (wie `HeaderAction.tsx:17`).

---

## 10. Tests

### 10.1 Unit (Vitest)

- `test/unit/prKey.test.ts` erweitern: `parsePullsUrl` (mit/ohne `?q=`, `?page=`, trailing slash, `/pulls/123` → undefined, `/issues` → undefined, GHES-Host).
- `test/unit/pulls.test.ts` (node): `assignPanels` – Dedupe Autor/Assignee, Rollen-Flags, P1-Vorrang vor P2, Sortierung (waiting → running → updatedAt), `primaryActionFor` (aktive Session → „Session öffnen“; Draft → Zusammenfassen; P1 ohne Infos → Zusammenfassen; P2 → Review), `prListItemToContext`.
- `test/unit/pullsPage.test.ts` (`// @vitest-environment jsdom`): `parsePullsHtml` gegen `test/fixtures/pulls-react.html` (3 Zeilen, inkl. Draft, Labels, `totalPages: 2`), gegen `pulls-classic.html` (Fallback), gegen HTML ohne Liste (→ leer + `source`), `readViewer` (gesetzt/leer/fehlend).
- `test/unit/prContext.test.ts` (jsdom): `readPrContext(location, doc)` gegen `test/fixtures/pr-page.html` – Branch, Autor, Draft, Checks; stellt sicher, dass das Refactoring die PR-Seite nicht bricht.
- `test/unit/sessionsForPrs.test.ts` (node): `SessionTracker.sessionsForPrs` mit gemocktem `Catalog`/`loadJobs` (Modul-Mock für `./storage`): Jobs + verlinkte Threads, Dedupe pro Thread, PRs ohne Treffer → `[]`, Titel-Match (`threadMentionsPrInTitle`).

Fixtures: aus dem heruntergeladenen `preactjs/preact`-HTML auf `<head>`-Metas, `react-app` + `embeddedData` (3 Einträge) und 3 `<li>` gekürzt (< 30 KB); Klassik-Fixture handgeschrieben nach bekanntem Markup (⚠️ als „unverifiziert“ kommentieren).

### 10.2 E2E/Showcase

`test/e2e/showcase.mjs` ergänzen (nach dem PR-Teil, gleiche Fake-T3-Instanz):
1. `context.route("https://github.com/flaaaps/pondus/pulls*", …)` liefert `test/fixtures/showcase-pulls.html` (SSR-Layout mit `meta user-login=flaaaps`, 6 Demo-PRs); Varianten je `q`: `author:@me` → 3 Treffer (inkl. #5, Draft), `assignee:@me` → 1 Treffer (davon 1 Dupe), `review-requested:@me` → 2 Treffer. Route-Interception greift auch für Content-Script-Fetches.
2. Warten auf `#t3-code-chrome-pulls .t3-panel` × 2 und eine `.t3-status.waiting`-Badge (Thread `t-review` ist an #5 gebunden, `fakeT3.mjs:80`).
3. Screenshots: `docs/screenshots/pulls-panels.png` (beide Panels), `pulls-row-menu.png` (geöffnetes Zeilen-Menü), optional `pulls-dark.png` (`colorScheme: "dark"`), Review-Set unter `test/e2e/out/review/` für schmale Breite (760 px).
4. Klick auf „Session öffnen“ prüft, dass `thread.open` gesendet wird (Worker-`console.info` oder Tab-Query), Klick auf „Review starten“ erwartet den Countdown-Toast mit `#7`-Detail und bricht ab.
5. `test/e2e/run.mjs` (Live-T3): optionaler Schritt `--pulls`: öffnet `https://github.com/flaaaps/pondus/pulls` eingeloggt? Nein – der Runner ist ausgeloggt; daher nur Assertion „keine Panels ohne Login, keine Fehler in der Konsole“.

---

## 11. Arbeitspakete

Aufwand: S ≤ 0,5 Tag, M ≈ 1 Tag, L ≈ 2 Tage.

**AP0 – Spike: eingeloggte Verifikation (S, blockiert AP2/AP5)**
Dateien: keine (Konsole im DevTools-Content-Script-Kontext, Notizen in `docs/plans/pulls-overview-panels.md` Abschnitt 2 nachtragen).
Prüfen: (a) `fetch("/o/r/pulls?q=is:pr state:open review-requested:@me", {credentials:"same-origin"})` liefert HTML mit `embeddedData` und Treffern; (b) `meta[name=user-login]` gesetzt; (c) Markup der geladenen Review-/Checks-Elemente in der Liste (Selektoren, `aria-label`); (d) gefetchte PR-Seite enthält `.head-ref`/Branch (oder wo sonst); (e) 20 Fetches in Folge ohne 429.
Akzeptanz: Ergebnisse als ✅/❌ in Abschnitt 2 eingetragen; Entscheidung, ob Klassik-Fallback nötig bleibt.

**AP1 – Erkennung und Mount-Gerüst (S)**
Dateien: `src/shared/prKey.ts`, `src/content/github/prDetector.ts`, `src/content/github/pullsMountPoints.ts`, `src/content/index.ts`, `test/unit/prKey.test.ts`.
Akzeptanz: Auf `/o/r/pulls` erscheint ein leerer Host vor `react-app`, überlebt Filterwechsel (Data Router) und verschwindet beim Repo-/Seitenwechsel; auf PR-Seiten unverändertes Verhalten; `pnpm test`, `pnpm typecheck`, `pnpm lint` grün.

**AP2 – Parser und Panel-Zuordnung (M)**
Dateien: `src/shared/pulls.ts`, `src/content/github/pullsPage.ts`, Fixtures, `test/unit/pulls.test.ts`, `test/unit/pullsPage.test.ts`.
Akzeptanz: `parsePullsHtml` liest die React-Fixture (Nummer, Titel, Autor, Draft, Labels, Seitenzahlen) und die Klassik-Fixture; `assignPanels` dedupliziert und flaggt Rollen; Fetch-Cache 60 s; Tests decken Leer-/Fehlerfälle ab.

**AP3 – Panels-UI ohne Aktionen (M)**
Dateien: `src/content/ui/pullsStore.ts`, `src/content/ui/PullsPanels.tsx`, `src/content/ui/styles.ts`, `src/content/index.ts`.
Akzeptanz: Lade-Skeleton, zwei Panels mit Zeilen (Icon, Titel-Link, #N, Autor, Labels, Zeit, Kommentare, Rollen-Badge), Leerzustände, Fehlerzustand mit Retry, Einklappen persistent, Dark Mode korrekt, 760-px-Layout ohne Überlauf; keine Aktionen.

**AP4 – Batch-Session-Zuordnung (S)**
Dateien: `src/shared/models.ts`, `src/shared/messages.ts`, `src/background/sessions.ts`, `src/background/router.ts`, `src/content/ui/pullsStore.ts`, `src/content/ui/PullsPanels.tsx`, `test/unit/sessionsForPrs.test.ts`.
Akzeptanz: Ein `prs.sessions`-Request pro Load; Badges „wartet/läuft/fertig“ pro Zeile, Sortierung nach Session-Zustand; `sessions.updated` aktualisiert Badges ohne Reload; Offline/Ungekoppelt zeigt Hinweis in der Kopfzeile, Panels bleiben nutzbar.

**AP5 – Quick-Actions (L)**
Dateien: `src/content/github/prContext.ts` (Refactoring `root`), `src/content/github/prFetch.ts`, `src/shared/intent.ts`, `src/content/ui/store.ts` (`activateContext`, Promise aus `quickDispatch`, Toast-Detail), `src/content/ui/Composer.tsx` (PR-Zeile), `src/content/ui/PullsPanels.tsx` (`RowActions`), `test/unit/prContext.test.ts`, `test/unit/intent.test.ts`.
Akzeptanz: Primär „Session öffnen“ bei aktiver Session (öffnet T3), sonst Intent-Button; Ein-Klick startet mit Countdown-Toast inkl. `#N Titel`, „Anpassen“ öffnet den Composer mit PR-Bezug und vorgewähltem Ziel (Worktree auf dem ermittelten Branch); Branch-Fallback auf Projekt-Checkout mit Hinweis; Menü per Tastatur bedienbar (Tab, ↑/↓, Esc); Fokus kehrt zum Button zurück; bestehende PR-Seiten-Tests (`test/e2e/run.mjs`) weiterhin grün.

**AP6 – Einstellungen (S)**
Dateien: `src/shared/models.ts`, `src/shared/messages.ts`, `src/options/Options.tsx`, `src/content/index.ts` (Setting vor Mount lesen).
Akzeptanz: Karte „PR-Übersicht“ mit Checkbox; aus → kein Host auf `/pulls` (ohne Reload wirksam beim nächsten Navigationsereignis, sonst nach Reload); Default an.

**AP7 – Showcase, Screenshots, Doku (M)**
Dateien: `test/e2e/showcase.mjs`, `test/fixtures/showcase-pulls.html`, `test/e2e/fakeT3.mjs` (zweiter verlinkter PR `#7` für ein „läuft“-Badge in P2), `README.md`, `docs/IMPLEMENTATION_PLAN.md`.
Akzeptanz: `pnpm screenshots` erzeugt `pulls-panels.png` und `pulls-row-menu.png`; README-Abschnitt „PR-Übersicht“ mit Screenshot; Release-Workflow unverändert grün.

**AP8 – V2-Erweiterungen (je S–M, nach Freigabe)**
a) DOM-Sync für Checks-/Review-Status aus GitHubs Liste (→ bessere Primär-Aktion „CI fixen“/„Kommentare abarbeiten“, Status-Icons in der Zeile). b) Drittes Panel „Übrige offene“ + „GitHub-Liste ausblenden“. c) Zweite Ergebnisseite pro Query (Cap 50). d) Inline-Antwort bei `waiting` direkt in der Zeile (Antwortfeld wie `AgentBox.tsx:152`). e) Shortcut `Alt+Shift+T` auf `/pulls` für die fokussierte Zeile.

Reihenfolge: AP0 → AP1 → AP2 → AP3 → AP4 → AP5 → AP6 → AP7; AP2 und AP4 können parallel zu AP1/AP3 beginnen (reine Logik). MVP = AP0–AP7 (≈ 5–6 Tage), V2 = AP8.

---

## 12. Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| GitHub ändert `embeddedData`-Form oder `data-testid`s | Panels leer/fehlerhaft | Parser mit Diagnose-Warnung, Klassik-/DOM-Fallback, Fixture-Tests; Selektoren in einer Datei; Fehlerzustand statt stiller Leere. |
| `fetch` der Suchseite liefert kein SSR (AP0 ❌) | Hauptdatenquelle entfällt | Plan B: nur die sichtbare Liste parsen und den Nutzer-Filter per Query-Chips (`author:@me`, `review-requested:@me`) **vorschlagen** statt selbst zu laden; P1/P2 dann als Umschalter, der `?q=` setzt. Deutlich schwächer, aber ohne Fetch. |
| Keine Branch-Info in der Liste | Worktree-Start braucht Fetch der PR-Seite | Lazy, gecacht, Fallback Projekt-Checkout mit Hinweis. |
| Mehrere Ein-Klick-Aktionen in kurzer Folge | Single-PR-Store | Primär-Buttons während eines Countdowns deaktivieren; Menü/Composer weiter möglich. |
| Rate-Limit/Abuse-Erkennung durch GitHub | temporäre 429 | 60-s-Cache, max. 3 Fetches pro Repo/Minute, Backoff bei 429 (5 min), Fehlerzustand. |
| GHES mit klassischer Liste nicht testbar | Fallback ungeprüft | Fixture-Test, explizit als unverifiziert markieren, Feedback-Hinweis in den Optionen. |
| Panels konkurrieren optisch mit GitHubs Liste | Seite wird lang | Einklappen persistent, kompakte Zeilen (36–44 px), V2 „GitHub-Liste ausblenden“. |

---

## 13. Entschiedene Fragen (Julian, 2026-11-03)

Alle Empfehlungen wurden übernommen:

| Frage | Entscheidung |
|---|---|
| Q1 Panel-Reihenfolge | **„Review angefragt“ zuerst**, dann „Meine Pull Requests“ (Inbox-Logik). |
| Q2 Assignee-Semantik | **Ja**, Assignee-PRs laufen in „Meine Pull Requests“ mit, Badge „zugewiesen“ wenn nicht Autor. |
| Q3 Antworten in der Zeile | **Nicht im MVP**; als AP8d vorgemerkt. |
| Q4 Tastenkürzel auf `/pulls` | **Nein**, Shortcut bleibt PR-Seiten vorbehalten. |
| Q5 Standardaktion eigener PRs | **„Zusammenfassen“** in „Meine Pull Requests“, „Review starten“ in „Review angefragt“. |
| Q6 Fallback bei AP0-Scheitern | **Plan B** (Panels als Filter-Umschalter auf GitHubs Liste), kein GitHub-Token. |

Ursprüngliche Fragen mit Begründung der Empfehlungen:

**Q1 – Panel-Reihenfolge.** „Meine PRs“ zuerst (deine Vorgabe) oder „Review angefragt“ zuerst (Inbox-Logik: andere warten auf dich, konsistent mit dem Popup „Wartet auf dich“ zuerst)?
Empfehlung: **„Review angefragt“ zuerst** – das ist der Teil, bei dem die Extension am meisten Zeit spart (Review starten mit einem Klick), und eigene PRs hat man meist ohnehin im Kopf. Falls du bei P1 = Meine bleibst, ist das ein Einzeiler.

**Q2 – Assignee-Semantik.** Sollen Assignee-PRs in P1 mitlaufen (Empfehlung: ja, mit Badge „zugewiesen“), oder nur Autor-PRs?
Empfehlung: **ja, in P1** – spart ein Panel und entspricht „mein Ball“.

**Q3 – Antworten direkt in der Zeile.** Bei `waiting`-Sessions könnte die Zeile ein Antwortfeld zeigen (wie Agent-Box/Popup). Das erfordert den Multi-PR-Store (8.4).
Empfehlung: **nicht im MVP**; „Session öffnen“ bzw. das Popup decken es ab. Als AP8d vormerken.

**Q4 – Tastenkürzel auf `/pulls`.** Soll `Alt+Shift+T` auf der Übersicht etwas tun (Composer für die fokussierte Zeile)?
Empfehlung: **nein im MVP**; Fokus-Semantik auf einer Liste ist unklar, Nutzen gering.

**Q5 – Standardaktion für eigene PRs ohne Statusinfos.** „Zusammenfassen“ (Empfehlung, da man eigene PRs selten reviewt) oder „Review starten“ wie im Header?
Empfehlung: **„Zusammenfassen“ in P1, „Review starten“ in P2**; sobald AP8a Checks/Review-Status liefert, greifen „CI fixen“/„Kommentare abarbeiten“ automatisch.

**Q6 – Fallback, falls AP0 (SSR-Fetch) scheitert.** Bist du mit Plan B (Panels nur als Filter-Umschalter auf GitHubs Liste) einverstanden, oder soll dann ein GitHub-Token als optionale Einstellung eingeführt werden?
Empfehlung: **Plan B**; ein Token widerspricht der bisherigen „kein GitHub-Token“-Linie und bringt eigene Sicherheitsfragen.
