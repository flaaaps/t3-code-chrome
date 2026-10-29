import { type ExtensionEvent, sendRequest } from "@shared/client";
import type {
  ConnectionHealth,
  ExtensionSettings,
  McpClientAccess,
  PromptTemplate,
  ServerConnection,
} from "@shared/models";
import { listPlaceholders, PLACEHOLDERS, renderTemplate, SAMPLE_PR } from "@shared/templates/render";
import { useEffect, useMemo, useState } from "preact/hooks";

type Tab = "connections" | "actions" | "settings";

const ACCESS_LEVELS: Array<{ value: McpClientAccess; label: string; hint: string }> = [
  {
    value: "full-access",
    label: "Vollzugriff",
    hint: "Agent arbeitet ohne Rückfragen, darf pushen und kommentieren.",
  },
  { value: "auto", label: "Auto", hint: "Agent arbeitet weitgehend selbständig." },
  {
    value: "auto-accept-edits",
    label: "Edits automatisch",
    hint: "Dateiänderungen automatisch, Befehle mit Rückfrage.",
  },
  {
    value: "approval-required",
    label: "Freigabe nötig",
    hint: "Jede Aktion braucht eine Freigabe in T3 Code.",
  },
  { value: "read-only", label: "Nur lesen", hint: "Reicht nicht für Reviews, die Kommentare posten." },
];

function healthLabel(health: ConnectionHealth): string {
  switch (health) {
    case "connected":
      return "verbunden";
    case "unauthenticated":
      return "nicht gekoppelt";
    case "unreachable":
      return "nicht erreichbar";
    default:
      return "unbekannt";
  }
}

export function Options() {
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash.replace("#", "");
    return hash === "actions" || hash === "settings" || hash === "connections" ? hash : "connections";
  });
  return (
    <div>
      <div class="row" style="margin-bottom:12px">
        <div class="grow">
          <h1>T3 Code for GitHub</h1>
          <p class="muted">Pull Requests aus dem Browser an T3-Code-Sessions übergeben.</p>
        </div>
      </div>
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "connections"}
          class={tab === "connections" ? "active" : ""}
          onClick={() => setTab("connections")}
        >
          Verbindungen
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "actions"}
          class={tab === "actions" ? "active" : ""}
          onClick={() => setTab("actions")}
        >
          Aktionen
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "settings"}
          class={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          Einstellungen
        </button>
      </div>
      {tab === "connections" ? <Connections /> : null}
      {tab === "actions" ? <Actions /> : null}
      {tab === "settings" ? <Settings /> : null}
    </div>
  );
}

function Connections() {
  const [connections, setConnections] = useState<ServerConnection[]>([]);
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({});
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = async () => {
    const list = await sendRequest({ type: "connections.list" });
    setConnections(list.connections);
    setHealth(list.health);
  };

  useEffect(() => {
    void sendRequest({ type: "connections.autoDetect" })
      .catch(() => undefined)
      .then(refresh);
    const listener = (event: ExtensionEvent) => {
      if (event.type === "connections.updated") void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const add = () =>
    run("add", async () => {
      const normalized = origin.trim();
      if (!normalized) return;
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`);
      } catch {
        throw new Error("Das ist keine gültige Adresse.");
      }
      if (!/^(127\.0\.0\.1|localhost)$/i.test(url.hostname)) {
        const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
        if (!granted)
          throw new Error("Ohne Zugriff auf diese Adresse kann die Extension den Server nicht erreichen.");
      }
      await sendRequest({ type: "connections.add", origin: normalized });
      setOrigin("");
    });

  return (
    <div class="stack">
      {error ? <div class="alert error">{error}</div> : null}
      {connections.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          health={health[connection.id] ?? "unknown"}
          busy={busy}
          run={run}
        />
      ))}
      <div class="card">
        <h2>Weiteren T3-Code-Server verbinden</h2>
        <p class="muted">
          Die lokale Desktop-App wird automatisch erkannt. Andere Rechner (z. B. über Tailscale) lassen sich
          mit ihrer Adresse ergänzen; verlinkte Environments eines Servers werden mit angeboten, wenn T3 sie
          freigibt.
        </p>
        <div class="row">
          <input
            class="input grow"
            value={origin}
            onInput={(e) => setOrigin((e.target as HTMLInputElement).value)}
            placeholder="https://mein-rechner.tailnet.ts.net"
          />
          <button type="button" class="btn" disabled={busy === "add" || !origin.trim()} onClick={add}>
            {busy === "add" ? "Prüfe…" : "Hinzufügen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({
  connection,
  health,
  busy,
  run,
}: {
  connection: ServerConnection;
  health: ConnectionHealth;
  busy: string | undefined;
  run: (key: string, action: () => Promise<void>) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [access, setAccess] = useState<McpClientAccess>("full-access");
  const id = connection.id;
  const command = 't3 auth pairing create --ttl 10m --label "Chrome"';
  return (
    <div class="card">
      <div class="row">
        <div class="grow">
          <h2 style="margin:0">{connection.label}</h2>
          <div class="muted">
            {connection.origin}
            {connection.serverVersion ? ` · T3 Code ${connection.serverVersion}` : ""}
          </div>
        </div>
        <span class={`status ${health}`}>{healthLabel(health)}</span>
        <button
          type="button"
          class="btn small"
          disabled={busy === `probe:${id}`}
          onClick={() =>
            run(`probe:${id}`, async () => void (await sendRequest({ type: "connections.probe", id })))
          }
        >
          Prüfen
        </button>
      </div>

      {health === "unreachable" ? (
        <div class="alert">
          T3 Code antwortet nicht unter dieser Adresse. Läuft die Desktop-App? Dann „Prüfen“.
        </div>
      ) : null}

      {health === "unauthenticated" ? (
        <div class="stack" style="border-top:1px solid var(--border);padding-top:10px">
          <strong>Koppeln</strong>
          <div class="muted">
            In T3 Code: Settings → Connections → <strong>Pair a client</strong>, oder im Terminal:
          </div>
          <div class="row">
            <code class="grow" style="overflow:auto;white-space:nowrap">
              {command}
            </code>
            <button
              type="button"
              class="btn small"
              onClick={() => void navigator.clipboard.writeText(command)}
            >
              Kopieren
            </button>
          </div>
          <div class="row">
            <input
              class="input grow"
              placeholder="Pairing-Code"
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            />
            <select
              class="select"
              style="max-width:200px"
              aria-label="Zugriffslevel"
              value={access}
              onChange={(e) => setAccess((e.target as HTMLSelectElement).value as McpClientAccess)}
            >
              {ACCESS_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="btn primary"
              disabled={!code.trim() || busy === `pair:${id}`}
              onClick={() =>
                run(`pair:${id}`, async () => {
                  await sendRequest({ type: "connections.pairWithCode", id, code: code.trim(), access });
                  setCode("");
                })
              }
            >
              {busy === `pair:${id}` ? "Kopple…" : "Koppeln"}
            </button>
          </div>
          <div class="muted">{ACCESS_LEVELS.find((l) => l.value === access)?.hint}</div>
          <button
            type="button"
            class="btn link"
            style="align-self:flex-start"
            disabled={busy === `browser:${id}`}
            onClick={() =>
              run(
                `browser:${id}`,
                async () => void (await sendRequest({ type: "connections.pairInBrowser", id })),
              )
            }
          >
            Alternativ über die Freigabeseite von T3 Code koppeln
          </button>
        </div>
      ) : null}

      <div class="row" style="justify-content:flex-end">
        {health === "connected" ? (
          <button
            type="button"
            class="btn small"
            onClick={() =>
              run(
                `disconnect:${id}`,
                async () => void (await sendRequest({ type: "connections.disconnect", id })),
              )
            }
          >
            Trennen
          </button>
        ) : null}
        <button
          type="button"
          class="btn small danger"
          onClick={() => {
            if (confirm(`Verbindung „${connection.label}“ entfernen?`)) {
              void run(
                `remove:${id}`,
                async () => void (await sendRequest({ type: "connections.remove", id })),
              );
            }
          }}
        >
          Entfernen
        </button>
      </div>
    </div>
  );
}

function Actions() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [editing, setEditing] = useState<PromptTemplate | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const refresh = async () => {
    const { templates: list } = await sendRequest({ type: "templates.list" });
    setTemplates(list);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    if (!editing) return;
    const { templates: list } = await sendRequest({ type: "templates.save", template: editing });
    setTemplates(list);
    setEditing(undefined);
    setMessage("Aktion gespeichert.");
  };

  const reset = async (template: PromptTemplate) => {
    const { templates: list } = await sendRequest({ type: "templates.delete", id: template.id });
    setTemplates(list);
    setEditing(undefined);
    setMessage(template.builtin ? "Auf die mitgelieferte Fassung zurückgesetzt." : "Aktion gelöscht.");
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(templates, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "t3-code-chrome-aktionen.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as PromptTemplate[];
      if (!Array.isArray(parsed)) throw new Error("Die Datei enthält keine Liste.");
      const { templates: list } = await sendRequest({ type: "templates.import", templates: parsed });
      setTemplates(list);
      setMessage(`${parsed.length} Aktionen importiert.`);
    } catch (e) {
      setMessage(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const newTemplate = () =>
    setEditing({
      id: `custom:${crypto.randomUUID().slice(0, 8)}`,
      name: "Neue Aktion",
      actionLabel: "Neue Aktion",
      body: "Verknüpfe diesen Thread mit {{pr.url}} (`link_pull_request`).\n\n{{user.note}}",
      builtin: false,
      defaultTarget: "new",
      preferWorktree: true,
      requires: ["note"],
    });

  return (
    <div class="stack">
      <div class="row">
        <p class="muted grow">
          Aktionen sind die Einträge im Split-Button auf der PR-Seite. Jede Aktion ist ein Prompt mit
          Platzhaltern; der Agent bekommt zusätzlich eine Kontextzeile mit PR-URL und Branch.
        </p>
        <button type="button" class="btn small" onClick={newTemplate}>
          Neue Aktion
        </button>
        <button type="button" class="btn small" onClick={exportAll}>
          Exportieren
        </button>
        <label class="btn small" style="cursor:pointer">
          Importieren
          <input
            type="file"
            accept="application/json"
            style="display:none"
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) void importFile(file);
            }}
          />
        </label>
      </div>
      {message ? <div class="alert">{message}</div> : null}

      {editing ? (
        <Editor
          template={editing}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(undefined)}
          onReset={() => void reset(editing)}
        />
      ) : null}

      <div class="list">
        {templates.map((template) => (
          <div class="item" key={template.id}>
            <div style="flex:1;min-width:0">
              <div class="title">
                {template.actionLabel ?? template.name}{" "}
                {template.builtin ? <span class="muted">· mitgeliefert</span> : null}
              </div>
              <div class="muted">{template.description ?? ""}</div>
            </div>
            <button type="button" class="btn small" onClick={() => setEditing({ ...template })}>
              Bearbeiten
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Editor({
  template,
  onChange,
  onSave,
  onCancel,
  onReset,
}: {
  template: PromptTemplate;
  onChange: (next: PromptTemplate) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const preview = useMemo(
    () =>
      renderTemplate(template.body, {
        pr: SAMPLE_PR,
        note: "Fokus auf die Mandantentrennung.",
        reviewOutput: "inline",
      }),
    [template.body],
  );
  const used = listPlaceholders(template.body);
  const insert = (name: string) => onChange({ ...template, body: `${template.body}{{${name}}}` });
  return (
    <div class="card">
      <h2>{template.builtin ? "Mitgelieferte Aktion anpassen" : "Aktion bearbeiten"}</h2>
      <div class="split">
        <div class="stack">
          <div class="row">
            <label class="field grow">
              Name
              <input
                class="input"
                value={template.name}
                onInput={(e) => onChange({ ...template, name: (e.target as HTMLInputElement).value })}
              />
            </label>
            <label class="field grow">
              Beschriftung im Button
              <input
                class="input"
                value={template.actionLabel ?? ""}
                onInput={(e) => onChange({ ...template, actionLabel: (e.target as HTMLInputElement).value })}
              />
            </label>
          </div>
          <label class="field">
            Beschreibung
            <input
              class="input"
              value={template.description ?? ""}
              onInput={(e) => onChange({ ...template, description: (e.target as HTMLInputElement).value })}
            />
          </label>
          <div class="row">
            <label class="field grow">
              Standard-Ziel
              <select
                class="select"
                value={template.defaultTarget}
                onChange={(e) =>
                  onChange({
                    ...template,
                    defaultTarget: (e.target as HTMLSelectElement).value as "new" | "existing",
                  })
                }
              >
                <option value="new">Neue Session</option>
                <option value="existing">Session dieser PR</option>
              </select>
            </label>
            <label class="field grow">
              Pflichtangaben
              <select
                class="select"
                value={(template.requires ?? []).join(",")}
                onChange={(e) => {
                  const value = (e.target as HTMLSelectElement).value;
                  const next = { ...template };
                  if (value) next.requires = value.split(",") as Array<"note" | "comment">;
                  else delete next.requires;
                  onChange(next);
                }}
              >
                <option value="">keine</option>
                <option value="note">Text des Nutzers</option>
                <option value="comment">Kommentar</option>
                <option value="note,comment">Text und Kommentar</option>
              </select>
            </label>
          </div>
          <label class="check">
            <input
              type="checkbox"
              checked={template.reviewOutput ?? false}
              onChange={(e) =>
                onChange({ ...template, reviewOutput: (e.target as HTMLInputElement).checked })
              }
            />
            <span>
              Schalter „Inline-Kommentare / Nur Bericht“ anbieten{" "}
              <span class="muted">(füllt {"{{review.output}}"})</span>
            </span>
          </label>
          <label class="field">
            Prompt
            <textarea
              class="textarea"
              value={template.body}
              onInput={(e) => onChange({ ...template, body: (e.target as HTMLTextAreaElement).value })}
            />
          </label>
          <div class="stack">
            <span class="muted">Platzhalter einfügen (verwendet: {used.join(", ") || "keine"})</span>
            <div class="chips">
              {PLACEHOLDERS.map((p) => (
                <button type="button" key={p.name} class="chip" title={p.hint} onClick={() => insert(p.name)}>
                  {`{{${p.name}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div class="stack">
          <span class="muted">
            Vorschau mit einer Beispiel-PR ({SAMPLE_PR.owner}/{SAMPLE_PR.repo}#{SAMPLE_PR.number})
          </span>
          <pre class="code" style="max-height:480px">
            {preview}
          </pre>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end">
        {template.builtin ? (
          <button type="button" class="btn link" onClick={onReset}>
            Auf mitgelieferte Fassung zurücksetzen
          </button>
        ) : (
          <button type="button" class="btn link danger" onClick={onReset}>
            Löschen
          </button>
        )}
        <span class="grow" />
        <button type="button" class="btn" onClick={onCancel}>
          Abbrechen
        </button>
        <button
          type="button"
          class="btn primary"
          onClick={onSave}
          disabled={!template.name.trim() || !template.body.trim()}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

function Settings() {
  const [settings, setSettings] = useState<ExtensionSettings | undefined>(undefined);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void sendRequest({ type: "settings.get" }).then(({ settings: s }) => setSettings(s));
  }, []);

  const update = async (patch: Partial<ExtensionSettings>) => {
    const { settings: next } = await sendRequest({ type: "settings.set", settings: patch });
    setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!settings) return <div class="muted">Lade…</div>;
  return (
    <div class="stack">
      <div class="card">
        <h2>Ein-Klick-Aktion</h2>
        <label class="field">
          Bedenkzeit vor dem Start
          <select
            class="select"
            value={String(settings.dispatchDelaySeconds)}
            onChange={(e) =>
              void update({ dispatchDelaySeconds: Number((e.target as HTMLSelectElement).value) })
            }
          >
            <option value="0">sofort starten</option>
            <option value="3">3 Sekunden</option>
            <option value="5">5 Sekunden</option>
            <option value="10">10 Sekunden</option>
          </select>
          <span class="hint">Solange zeigt ein Hinweis unten rechts „Abbrechen“ und „Anpassen“.</span>
        </label>
        <label class="field">
          Review-Ergebnis
          <select
            class="select"
            value={settings.defaultReviewOutput}
            onChange={(e) =>
              void update({
                defaultReviewOutput: (e.target as HTMLSelectElement).value as "inline" | "report",
              })
            }
          >
            <option value="inline">Inline-Kommentare auf GitHub (postet in deinem Namen)</option>
            <option value="report">Nur Bericht in T3</option>
          </select>
        </label>
      </div>
      <div class="card">
        <h2>Neue Sessions</h2>
        <label class="field">
          Arbeitsverzeichnis
          <select
            class="select"
            value={settings.defaultWorkspace}
            onChange={(e) =>
              void update({ defaultWorkspace: (e.target as HTMLSelectElement).value as "root" | "worktree" })
            }
          >
            <option value="worktree">Neuer Worktree auf dem PR-Branch (Checkout bleibt unberührt)</option>
            <option value="root">Projekt-Checkout</option>
          </select>
        </label>
        <label class="field">
          Modus des Agenten
          <select
            class="select"
            value={settings.defaultRuntimeMode}
            onChange={(e) =>
              void update({
                defaultRuntimeMode: (e.target as HTMLSelectElement)
                  .value as ExtensionSettings["defaultRuntimeMode"],
              })
            }
          >
            <option value="full-access">Vollzugriff</option>
            <option value="auto">Auto</option>
            <option value="auto-accept-edits">Edits automatisch</option>
            <option value="approval-required">Freigabe nötig</option>
          </select>
          <span class="hint">
            Effektiv gilt der engere Wert aus dieser Einstellung und dem Zugriffslevel der Kopplung.
          </span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.appendContextFooter}
            onChange={(e) => void update({ appendContextFooter: (e.target as HTMLInputElement).checked })}
          />
          <span>Kontextzeile mit PR-URL und Branch an jeden Prompt anhängen</span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.openInAppAfterDispatch}
            onChange={(e) => void update({ openInAppAfterDispatch: (e.target as HTMLInputElement).checked })}
          />
          <span>Nach dem Senden die Session in T3 Code öffnen</span>
        </label>
      </div>
      <div class="card">
        <h2>Benachrichtigungen</h2>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.notifyOnWaiting}
            onChange={(e) => void update({ notifyOnWaiting: (e.target as HTMLInputElement).checked })}
          />
          <span>Wenn ein Agent auf eine Antwort wartet</span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.notifyOnFinish}
            onChange={(e) => void update({ notifyOnFinish: (e.target as HTMLInputElement).checked })}
          />
          <span>Wenn eine Session fertig ist oder fehlschlägt</span>
        </label>
      </div>
      <ShortcutCard />
      {saved ? <div class="alert success">Gespeichert.</div> : null}
    </div>
  );
}

function ShortcutCard() {
  const [shortcut, setShortcut] = useState<string | undefined>(undefined);
  const refresh = () =>
    void sendRequest({ type: "shortcut.get" })
      .then((result) => setShortcut(result.shortcut))
      .catch(() => setShortcut(""));
  useEffect(() => {
    refresh();
    // The user may change the binding in the browser's shortcut page and come back.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return (
    <div class="card">
      <h2>Tastenkürzel</h2>
      <div class="row">
        <span class="grow">
          Composer auf einer PR-Seite öffnen:{" "}
          {shortcut === undefined ? "…" : shortcut ? <kbd>{shortcut}</kbd> : <strong>nicht belegt</strong>}
        </span>
        <button type="button" class="btn small" onClick={() => void sendRequest({ type: "shortcut.edit" })}>
          {shortcut ? "Ändern" : "Festlegen"}
        </button>
      </div>
      {shortcut === "" ? (
        <div class="alert">
          Der Browser hat kein Kürzel vergeben, meist weil die Kombination schon belegt ist. Lege unter
          „Festlegen“ eine freie Kombination fest.
        </div>
      ) : null}
      <p class="muted">
        Im Composer: <kbd>⌘</kbd> + <kbd>↩</kbd> sendet, <kbd>Esc</kbd> schließt.
      </p>
    </div>
  );
}
