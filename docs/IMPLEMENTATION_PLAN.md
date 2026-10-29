# t3-code-chrome – Implementierungsplan

Chrome-Extension (Manifest V3), die auf GitHub-PR-Seiten das Anstoßen von Reviews und Review-Bearbeitungen in T3 Code ermöglicht, ohne die PR-Seite zu verlassen. Browser und T3 Code laufen auf demselben Gerät.

Stand: 2026-10-29. Alle Angaben zur T3-Schnittstelle wurden gegen T3 Code 0.1.4 (Server-Bundle in `app.asar`, laufender Server auf `127.0.0.1:3773`) verifiziert.

---

## 1. Ziele und Nicht-Ziele

**Ziele**

- Auf jeder PR-Seite (`github.com/<owner>/<repo>/pull/<n>…`) ein Panel, das mit zwei bis drei Klicks einen Prompt an T3 schickt.
- Wahl zwischen neuer T3-Session (Thread) und bestehender Session; Antwort/Status der Session im Panel sichtbar.
- Alle T3-Environments (lokal und verlinkte) und alle Projekte ansteuerbar.
- Smarte Vorauswahl: Projekt anhand des Repos, Threads dieses Projekts zuerst, Threads mit Verknüpfung zu genau dieser PR ganz oben.
- Vorgefertigte Prompts (Review, Review-Kommentare abarbeiten, CI-Fehler fixen, eigene Templates) mit PR-Kontext-Variablen.

**Nicht-Ziele (v1)**

- Keine eigene GitHub-API-Anbindung mit Token. Der Agent in T3 hat `gh` und die T3-PR-Tools und holt sich Diff, Kommentare und Checks selbst. Die Extension liefert nur URL und Metadaten von der Seite.
- Kein Nachbau der T3-Chat-Oberfläche. Für volle Interaktion öffnet ein Button den Thread in der Desktop-App.
- Keine Unterstützung für Remote-Browser (T3 auf anderem Rechner) in v1; die Architektur lässt es aber zu (konfigurierbare Base-URL).

---

## 2. Verifizierte T3-Schnittstelle

### 2.1 Server-Discovery

- `~/.t3/userdata/server-runtime.json` enthält `origin` (aktuell `http://127.0.0.1:3773`). Eine Extension kann keine lokalen Dateien lesen, daher: Default-Origin `http://127.0.0.1:3773`, in den Optionen änderbar, mit Probe-Endpunkten:
  - `GET /.well-known/t3/environment` → `environmentId`, `label`, `serverVersion`, `capabilities` (unauthentifiziert).
  - `GET /health`.
  - `GET /api/auth/session` → Auth-Policy und erlaubte Methoden.
- CORS: Server antwortet mit `access-control-allow-origin: *` und erlaubt die Header `authorization`, `content-type`, `dpop`, `x-t3-orchestration-protocol`. Zusätzlich gilt: Fetches aus dem Extension-Service-Worker mit `host_permissions` unterliegen ohnehin nicht CORS.

### 2.2 Der MCP-Endpunkt ist die Integrations-API

T3 stellt unter `POST /mcp` einen Streamable-HTTP-MCP-Server (Protokoll 2025-06-18) bereit. Das ist dieselbe Schnittstelle, die die `t3`-CLI für `t3 thread start|send|list` benutzt. Für die Extension relevante Tools (alle akzeptieren optional `environmentId` für verlinkte Environments):

| Tool | Zweck |
|---|---|
| `t3_environment_read` | Identität und Einstellungen des lokalen Environments |
| `t3_environment_links` | Liste verlinkter Environments (Name beim Implementieren gegen `tools/list` prüfen) |
| `t3_project_list` | Projekte, inkl. `repositoryIdentity.canonicalKey` (z. B. `github.com/studypilot/monorepo`), `owner`, `name`, `provider` |
| `t3_thread_list` | Threads eines Projekts oder aller Projekte, mit `status`, `pullRequests[]` (host, repository, number, url, state), `updatedAt` |
| `t3_thread_search` | Volltextsuche über Titel, Branch, PR, Projekt |
| `t3_thread_launch` | Neuen Thread anlegen: `title`, `message`, `projectId`, `environmentId`, `modelSelection`, `runtimeMode`, `interactionMode`, `workspaceStrategy` (root / worktree / existing_worktree) |
| `t3_thread_send` | Nachricht an bestehenden Thread: `mode` auto / queue / steer / restart |
| `t3_thread_read` | Letzte Nachrichten lesen (für Status- und Ergebnisanzeige) |
| `t3_thread_wait` | Auf Run-Ende warten (mit `timeoutMs`) |
| `list_thread_pull_requests` | PRs, die ein Thread kennt |
| `read_pull_request_guide` | Gespeicherter Review-Guide einer PR |
| `orchestrator_capabilities` | Provider, Modelle, Optionen, Runtime-Modi für die Modellauswahl |

Thread-Objekte liefern einen `link` der Form `t3-thread://v2/<environmentId>/<threadId>`; damit lässt sich der Thread in der Desktop-App öffnen.

### 2.3 Authentifizierung: MCP-OAuth (empfohlen)

Der Server ist ein vollständiger OAuth-Authorization-Server für MCP-Clients:

- `GET /.well-known/oauth-authorization-server` → `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, PKCE `S256`, `token_endpoint_auth_methods_supported: ["none"]`.
- `POST /oauth/mcp/register`: Dynamic Client Registration mit `client_name`, `redirect_uris`. Redirect-URIs müssen `https://…` sein oder `http://` auf Loopback. Die Chrome-Identity-Redirect-URL `https://<extension-id>.chromiumapp.org/` erfüllt das.
- `GET /oauth/mcp/authorize?...` zeigt eine Freigabeseite. Freigabe erfolgt entweder über eine vorhandene T3-Browser-Session oder über einen Freigabe-Code, den die Desktop-App anzeigt (`decision: pairing-code`). Der Nutzer wählt dort das Zugriffslevel (`read-only`, `approval-required`, `auto-accept-edits`, `auto`, `full-access`).
- `POST /oauth/mcp/token` mit `authorization_code` + PKCE → `access_token` (Bearer) mit Ablaufzeit; die Session erscheint in T3 unter Settings → Connections und kann dort widerrufen werden.
- Nicht authentifizierte Aufrufe von `/mcp` liefern `401` mit `www-authenticate: Bearer resource_metadata=…` (Standard-MCP-Flow).

Ablauf in der Extension: `chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true })` → Code aus der Redirect-URL → Token-Exchange im Service Worker → Token in `chrome.storage.session` (Laufzeit) plus verschlüsselt in `chrome.storage.local` (Persistenz, siehe Abschnitt 5).

Fallback: Pairing-Token aus `t3 auth pairing create --json` bzw. Settings → Connections, in den Optionen eingefügt und über `POST /oauth/token` (Token-Exchange, `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`) gegen ein Bearer-Token getauscht. Ob dieses Environment-Token auch für `/mcp` akzeptiert wird, ist zu verifizieren; der primäre Weg ist OAuth.

### 2.4 Nicht gewählte Alternativen

- **WebSocket-RPC (`/ws`)**: Internes Effect-RPC-Protokoll (Version 2) der Web-UI, undokumentiert und versionsabhängig. Zu fragil.
- **CLI über Native Messaging**: Bräuchte einen Native-Host-Installer; MCP über HTTP leistet dasselbe ohne Installationsschritt.
- **T3-UI per iframe einbetten**: Server setzt `frame-ancestors 'none'`.

---

## 3. Architektur

```
┌──────────────────────── Chrome ─────────────────────────┐
│  github.com Tab                                         │
│  ┌──────────────────────┐  chrome.runtime.Port          │
│  │ Content Script       │◄───────────────────────────┐  │
│  │ - PR-Erkennung       │                            │  │
│  │ - Panel-Mount (Shadow│                            │  │
│  │   DOM, Preact)       │                            │  │
│  │ - DOM-Kontext (Titel,│                            │  │
│  │   Branches, Autor)   │                            │  │
│  └──────────────────────┘                            │  │
│                                                      ▼  │
│  ┌──────────────────────────────────────────────────────┐
│  │ Service Worker (Background)                          │
│  │ - T3Client (MCP Streamable HTTP, JSON-RPC)           │
│  │ - AuthManager (OAuth DCR+PKCE, Token-Refresh)        │
│  │ - Cache (Projekte, Threads, Environments)            │
│  │ - JobTracker (laufende Threads, Polling via wait)    │
│  │ - Message-Router (Content ↔ Popup ↔ Options)         │
│  └──────────────────────────────────────────────────────┘
│             │ fetch (host_permissions)                   │
└─────────────┼───────────────────────────────────────────┘
              ▼
   T3 Code Server  http://127.0.0.1:3773
   /mcp  /oauth/mcp/*  /.well-known/*
```

### 3.1 Komponenten

**Content Script (`src/content/`)**

- Wird nur auf `https://github.com/*` injiziert, aktiviert sich auf `/<owner>/<repo>/pull/<n>` (inkl. `/files`, `/commits`, `/checks`). GitHub ist eine Turbo-/PJAX-App: URL-Änderungen über `turbo:load`, `popstate` und einen `MutationObserver` auf `document.head > title` beobachten und das Panel ein-/aushängen.
- Liest reinen Seitenkontext aus dem DOM, ohne GitHub-API: Owner, Repo, Nummer, Titel, Head-/Base-Branch, Autor, Review-Status, Anzahl Review-Kommentare, aktuell ausgewählter Diff-Kommentar (bei Klick „an T3 senden“ in einer Kommentar-Toolbar).
- Mountet die UI in ein Shadow-DOM-Container (eigene Styles, keine Kollision mit GitHub-CSS). Zwei Einstiegspunkte: ein Button in der PR-Header-Actionbar („Mit T3 bearbeiten“) und ein Tastaturkürzel.
- Kommuniziert ausschließlich per `chrome.runtime.connect` Port mit dem Service Worker; hat selbst keinen Token.

**Service Worker (`src/background/`)**

- `T3Client`: Minimaler MCP-Client. `initialize` → `tools/list` → `tools/call`. Session-Header `Mcp-Session-Id` verwalten, JSON- und SSE-Antworten parsen, bei `401` Re-Auth auslösen, bei MCP-Fehlern typisierte Fehler werfen. Keine Abhängigkeit vom offiziellen SDK nötig, aber `@modelcontextprotocol/sdk` ist eine Option, falls der Streamable-HTTP-Client im Worker läuft (zu prüfen: Node-APIs im Bundle).
- `AuthManager`: Discovery, DCR (Client-ID je Server-Origin cachen), PKCE, `launchWebAuthFlow`, Token-Speicherung, Ablauf-Erkennung, Logout/Revoke.
- `Catalog`: Lädt und cached Environments, Projekte und Threads (TTL ~60 s, invalidiert bei eigenen Mutationen). Liefert dem UI vorsortierte Listen (Abschnitt 6).
- `JobTracker`: Für jeden gestarteten Auftrag `threadId`, `environmentId`, PR-Key, Startzeit. Pollt per `t3_thread_wait` (lange Timeouts) bzw. `t3_thread_read`; aktualisiert Badge und Panel. Zustand in `chrome.storage.session`, damit ein Worker-Neustart nichts verliert; `chrome.alarms` als Weckruf, weil MV3-Worker nach 30 s Leerlauf schlafen.
- `MessageRouter`: Typisierte Nachrichten (`zod`-Schemas) zwischen Content Script, Popup und Options.

**Popup (`src/popup/`)**: Verbindungsstatus, Liste laufender Aufträge, Schnellzugriff auf den letzten Thread, Button „Verbinden“. Bewusst klein.

**Options (`src/options/`)**: Server-Origin, Verbindung herstellen/trennen, Prompt-Templates verwalten (CRUD, Import/Export JSON), Standard-Modell/Runtime-Mode, Standard-Workspace-Strategie, Projekt-Overrides.

### 3.2 Datenfluss „Review starten“

1. Content Script erkennt PR, fordert vom Worker `getPrContext(prKey)` an.
2. Worker lädt (aus Cache) Environments, Projekte, Threads und berechnet die Vorschläge: passendes Projekt über `repositoryIdentity.canonicalKey === "github.com/<owner>/<repo>"` (Fallback: `owner/name`, Fallback: Titel-Ähnlichkeit); Threads sortiert nach (a) PR-Verknüpfung auf genau diese PR, (b) gleicher Projekt, aktiv/`waiting` zuerst, (c) Rest nach `updatedAt`.
3. Panel zeigt: Environment (vorausgewählt lokal), Projekt (vorausgewählt), Ziel „Neue Session“ / „Bestehende Session“ (Liste), Template-Auswahl, editierbaren Prompt, Modell/Runtime-Mode (eingeklappt), Workspace-Strategie (eingeklappt, Default aus Projekt-Einstellung).
4. Absenden → `launchThread` oder `sendToThread` mit `clientRequestId` (UUID) für idempotente Retries.
5. Worker registriert Job, Panel zeigt Status-Chip (queued → running → waiting/completed/failed) und ein „In T3 öffnen“-Link (`t3-thread://…`). Letzte Agent-Antwort wird per `t3_thread_read` (klein, `limit: 3`) als Vorschau angezeigt.

---

## 4. Prompt-Templates und Kontext

Templates sind Markdown mit Platzhaltern, gerendert im Worker:

| Platzhalter | Quelle |
|---|---|
| `{{pr.url}}`, `{{pr.number}}`, `{{pr.title}}` | URL / DOM |
| `{{pr.owner}}`, `{{pr.repo}}`, `{{pr.headBranch}}`, `{{pr.baseBranch}}` | DOM |
| `{{pr.author}}`, `{{pr.reviewState}}` | DOM |
| `{{selection}}` | markierter Text oder angeklickter Review-Kommentar |
| `{{user.note}}` | Freitextfeld im Panel |

Mitgelieferte Templates (bearbeitbar):

1. **Review durchführen**: „Review PR {{pr.url}} … nutze den Review-Guide, falls vorhanden; poste Findings als Inline-Kommentare.“ Erwähnt das Skill `/code-review`, falls Claude-Provider.
2. **Review-Kommentare abarbeiten**: „Hole alle offenen Review-Threads von {{pr.url}}, beantworte oder fixe sie, pushe, markiere erledigte Threads als resolved.“
3. **CI-Fehler beheben**: „Analysiere fehlgeschlagene Checks von {{pr.url}} …“
4. **Auf Kommentar reagieren**: nutzt `{{selection}}`.
5. **Freier Prompt**.

Jeder Prompt endet mit einer festen Kontext-Zeile (PR-URL, Branch), damit der Agent die PR mit `gh` oder `link_pull_request` findet. Bei neuen Threads wird standardmäßig `workspaceStrategy: { type: "worktree", baseRef: "<headBranch>", startFromOrigin: true }` angeboten, damit die Session auf dem PR-Branch arbeitet, ohne den Projekt-Checkout zu verändern; umschaltbar auf `root`.

---

## 5. Sicherheit

- Token liegt nur im Service Worker. Content Script bekommt nie Token oder Server-Origin, nur fertige View-Models.
- Persistenz des Access-Tokens in `chrome.storage.local`, zusätzlich AES-GCM-verschlüsselt mit einem per `crypto.subtle` erzeugten, in `chrome.storage.local` liegenden Schlüssel (Schutz gegen triviales Auslesen; echte Härtung ist in Extensions nicht möglich, deshalb kurze TTL und Revoke-Button).
- `host_permissions` nur `https://github.com/*` und der konfigurierte T3-Origin (`http://127.0.0.1:3773/*`; bei Änderung `chrome.permissions.request` zur Laufzeit statt Wildcard im Manifest).
- Zugriffslevel beim OAuth-Approve: Empfehlung `auto` bzw. `full-access`, damit Review-Sessions selbständig pushen können; die Extension erzwingt nichts, der Nutzer entscheidet in der T3-Freigabeseite.
- Kein Senden von Seiteninhalten außer den explizit genannten Feldern. Diff-Inhalte werden nicht übertragen, der Agent holt sie selbst.
- CSP der Extension: `script-src 'self'`; keine Remote-Skripte.

---

## 6. Datenmodell (Worker)

```ts
type ServerConfig = { origin: string; clientId?: string; environmentId?: string; label?: string };
type AuthState =
  | { kind: "disconnected" }
  | { kind: "connected"; accessToken: string; expiresAt: number; scopes: string[] };

type PrKey = { host: "github.com"; owner: string; repo: string; number: number };
type PrContext = PrKey & { title: string; headBranch?: string; baseBranch?: string; author?: string; reviewState?: string };

type EnvironmentRef = { environmentId: string; label: string; local: boolean; reachable: boolean };
type Project = { id: string; environmentId: string; title: string; canonicalKey?: string; defaultModelSelection?: ModelSelection };
type ThreadSummary = { threadId: string; environmentId: string; projectId: string; title: string; status: ThreadStatus; updatedAt: string; link: string; pullRequests: { url: string; number: number; repository: string; state: string }[] };

type PromptTemplate = { id: string; name: string; body: string; builtin: boolean; defaultTarget: "new" | "existing"; defaultMode?: "queue" | "steer" };

type Job = { id: string; clientRequestId: string; pr: PrKey; environmentId: string; threadId: string; title: string; startedAt: number; lastStatus: ThreadStatus; lastReply?: string; link: string };
```

Speicherorte: `ServerConfig`, Templates, Defaults → `chrome.storage.sync` (Templates) bzw. `local`; `AuthState` → `session` + verschlüsselt `local`; Jobs → `session` plus `local` (letzte 50, für Wiederfinden nach Browser-Neustart).

---

## 7. Technik-Stack und Projektstruktur

- **Build**: Vite + `@crxjs/vite-plugin` (MV3, HMR für Content Scripts), TypeScript strict, pnpm.
- **UI**: Preact + Signals (klein, Shadow-DOM-tauglich); Styling mit Tailwind im Shadow-Root oder plain CSS mit `github-primer`-ähnlichen Tokens, damit das Panel nativ wirkt. Dark-Mode über `data-color-mode` von GitHub ableiten.
- **Validierung**: `zod` für Nachrichten-Schemas und MCP-Antworten.
- **Tests**: Vitest (Unit: Template-Rendering, PR-URL-Parsing, Sortierlogik, MCP-Client gegen Mock-Server), Playwright mit geladener Extension (E2E gegen eine lokale GitHub-Seitenkopie und echten T3-Server).
- **Lint/Format**: Biome.

```
t3-code-chrome/
  manifest.config.ts
  src/
    background/   index.ts, t3Client.ts, mcp/ (transport.ts, types.ts), auth/ (oauth.ts, storage.ts), catalog.ts, jobs.ts, router.ts
    content/      index.ts, github/ (prDetector.ts, prContext.ts, mountPoints.ts), ui/ (Panel.tsx, TargetPicker.tsx, PromptEditor.tsx, JobStatus.tsx)
    popup/        index.html, Popup.tsx
    options/      index.html, Options.tsx, Templates.tsx
    shared/       messages.ts (zod), models.ts, templates/builtin.ts, prKey.ts, sort.ts
  test/           unit/, e2e/
  docs/           IMPLEMENTATION_PLAN.md
```

---

## 8. Implementierungsphasen

### Phase 0 – Spike (0,5 Tag)

- Minimaler Node-Skript-Prototyp: DCR → Authorize-URL ausgeben → Code manuell einfügen → Token → `tools/list` → `t3_project_list`. Bestätigt den OAuth-Flow inklusive Freigabeseite ohne Browser-Session.
- Prüfen, ob `/mcp` reine JSON-Antworten oder SSE liefert, und wie `Mcp-Session-Id` gehandhabt wird.
- Prüfen des exakten Tool-Namens für verlinkte Environments und der Antwortform.

Akzeptanz: Skript listet Projekte und startet einen Thread mit `t3_thread_launch`.

### Phase 1 – Grundgerüst und Verbindung (1–2 Tage)

- Vite/CRXJS-Setup, Manifest, Service Worker, Options-Seite.
- `AuthManager` mit `launchWebAuthFlow`, Token-Storage, Re-Auth bei 401, Revoke.
- `T3Client` mit `initialize`/`tools/call`, Fehler-Typen, Timeout, Retry bei Netzwerkfehler (nicht bei 4xx).
- Popup zeigt Verbindungsstatus und Environment-Label.

Akzeptanz: Nach „Verbinden“ in den Optionen zeigt das Popup Environment-Name und Projektanzahl.

### Phase 2 – PR-Panel und Start eines Threads (2–3 Tage)

- PR-Erkennung inklusive Turbo-Navigation; Button im PR-Header; Shadow-DOM-Panel.
- `Catalog` mit Projekt-Matching und Thread-Sortierung; Environment-Umschalter.
- Template-Engine, Built-in-Templates, Prompt-Editor.
- `launchThread` mit Modell/Runtime-Mode/Workspace-Strategie; `clientRequestId`.
- Job-Status im Panel, Link „In T3 öffnen“.

Akzeptanz: Auf einer PR aus `studypilot/monorepo` ist das Projekt vorausgewählt, „Review durchführen“ startet einen Thread im Worktree des PR-Branches, Status wird live aktualisiert.

### Phase 3 – Bestehende Sessions und Kontext-Aktionen (1–2 Tage)

- Thread-Liste mit Suche (`t3_thread_search`), Filter „nur diese PR“, Statusbadges.
- `sendToThread` mit Modus `queue`/`steer`/`restart`; Hinweis, wenn der Thread gerade läuft.
- Kontextmenü-Eintrag und Mini-Button an Review-Kommentaren („Mit T3 beantworten“) → `{{selection}}`.
- Letzte Agent-Antwort als Vorschau (`t3_thread_read`, kleine Limits).

Akzeptanz: Ein Review-Kommentar lässt sich mit zwei Klicks an die laufende Session der PR schicken.

### Phase 4 – Robustheit und Feinschliff (1–2 Tage)

- Worker-Lebenszyklus: Jobs in `storage.session`, `chrome.alarms` für Polling, Wiederaufnahme nach Neustart.
- Offline-/Fehlerzustände: T3 nicht erreichbar, Token abgelaufen, Environment nicht erreichbar, Projekt fehlt (Angebot: Thread in Scratch starten oder Projekt in T3 anlegen).
- Badge-Zähler laufender Jobs; optionale Desktop-Notification bei `waiting`/`completed`.
- Template-Import/Export, Projekt-spezifische Defaults.
- E2E-Tests, README mit Installationsanleitung (Load unpacked), Release-Zip über GitHub Action.

---

## 9. Risiken und offene Punkte

| Risiko | Einschätzung | Gegenmaßnahme |
|---|---|---|
| Freigabeseite benötigt Browser-Session oder Desktop-Code | Flow in Phase 0 verifizieren | Fallback: Pairing-Token-Eingabe in den Optionen |
| MCP-Tool-Namen/-Schemas ändern sich mit T3-Versionen | mittel, T3 ist Beta | `tools/list` beim Connect cachen, Aufrufe gegen Schema validieren, klare Fehlermeldung mit T3-Version |
| GitHub-DOM ändert sich | mittel | Selektoren zentral in `mountPoints.ts`, Fallback-Mount als Floating-Button, Kontext primär aus URL |
| MV3-Worker schläft während langer Runs | sicher | `t3_thread_wait` mit moderatem Timeout plus `chrome.alarms` |
| Token-Ablauf mitten im Job | sicher | 401 → Re-Auth-Hinweis im Panel, Job bleibt per `clientRequestId` wiederaufnehmbar |
| Verlinkte Environments offline | normal | Erreichbarkeit aus `t3_environment_links` anzeigen, Environment ausgrauen |

Beim Spike und in der Implementierung geklärt (Stand 2026-10-29):

- **Freigabe ohne Browser-Session**: `POST /oauth/mcp/decision` akzeptiert `{ _tag: "pairing-code", access, code }` mit einem Pairing-Token aus `t3 auth pairing create`. Die Extension führt damit den kompletten OAuth-Flow (DCR → PKCE → Decision → Token) ohne Freigabeseite durch; der Browser-Flow über `chrome.identity.launchWebAuthFlow` bleibt als Alternative.
- **Origin-Header**: `/mcp` antwortet mit 403, sobald ein `Origin`-Header mitkommt, der nicht in der (leeren) Allow-List steht. Chrome sendet bei Extension-Requests immer `Origin: chrome-extension://…`. Lösung: eine `declarativeNetRequest`-Session-Regel entfernt den Header für Requests der Extension an die konfigurierten T3-Server (`src/background/netRules.ts`).
- **Verlinkte Environments**: Für MCP-Clients ist kein `t3_environment_links`-Tool sichtbar, solange „Linked environments“ in T3 aus ist. Die Extension prüft `tools/list` dynamisch und bietet verlinkte Environments nur an, wenn das Tool existiert. Zusätzlich lassen sich mehrere T3-Server direkt per URL anbinden.
- **Deep Link**: `t3code://threads/<environmentId>/<threadId>` öffnet den Thread in der Desktop-App (verifiziert). Für entfernte Server wird die Web-UI unter `<origin>/<environmentId>/<threadId>` geöffnet.
- **Antwortformat**: `/mcp` liefert reine JSON-Antworten mit `mcp-session-id`-Header; Tool-Ergebnisse kommen als JSON-Text im `content`-Block. Der Transport unterstützt zusätzlich SSE, falls spätere Versionen streamen.
- **Modellwahl**: `modelSelection` nimmt `{ instanceId, model }` aus `orchestrator_capabilities`.
- **GitHub-DOM**: Der aktuelle PR-Header hat keine `.head-ref`-Klasse mehr; Head und Base werden aus den `.commit-ref`-Chips und dem Satz „into … from …“ abgeleitet.

## 10. Stand der Umsetzung

Alle vier Phasen sind umgesetzt und gegen den echten T3-Server getestet (`node test/e2e/run.mjs --dispatch`): Pairing, Projekt-Vorauswahl, Session-Liste mit PR-Priorisierung, Start eines Threads, Senden an bestehende Threads, Status-Tracking bis `completed`, Kommentar-Buttons, Kontextmenü, Popup, Optionen mit Template-Editor, Benachrichtigungen. Unit-Tests decken URL-Parsing, Repo-Matching, Thread-Ranking und Template-Rendering ab.
