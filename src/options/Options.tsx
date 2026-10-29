import { type ExtensionEvent, sendRequest } from "@shared/client";
import type {
  ConnectionHealth,
  ExtensionSettings,
  McpClientAccess,
  PromptTemplate,
  ServerConnection,
} from "@shared/models";
import { listPlaceholders } from "@shared/templates/render";
import { useEffect, useState } from "preact/hooks";

type Tab = "connections" | "templates" | "settings";

const ACCESS_LEVELS: Array<{ value: McpClientAccess; label: string; hint: string }> = [
  { value: "full-access", label: "Full access", hint: "Agent darf ohne Rückfragen arbeiten, auch pushen." },
  { value: "auto", label: "Auto", hint: "Agent arbeitet weitgehend selbständig." },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    hint: "Edits automatisch, Befehle mit Rückfrage.",
  },
  { value: "approval-required", label: "Approval required", hint: "Jede Aktion braucht Freigabe in T3." },
  { value: "read-only", label: "Read-only", hint: "Nur lesen; reicht nicht für Reviews mit Kommentaren." },
];

export function Options() {
  const [tab, setTab] = useState<Tab>("connections");
  return (
    <div>
      <div class="row" style="margin-bottom:12px">
        <div style="flex:1">
          <h1>T3 Code for GitHub</h1>
          <p class="muted">Pull Requests aus dem Browser an T3-Code-Sessions übergeben.</p>
        </div>
      </div>
      <div class="tabs">
        <button
          type="button"
          class={tab === "connections" ? "active" : ""}
          onClick={() => setTab("connections")}
        >
          Verbindungen
        </button>
        <button type="button" class={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}>
          Prompt-Vorlagen
        </button>
        <button type="button" class={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          Einstellungen
        </button>
      </div>
      {tab === "connections" ? <Connections /> : null}
      {tab === "templates" ? <Templates /> : null}
      {tab === "settings" ? <Settings /> : null}
    </div>
  );
}

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

function Connections() {
  const [connections, setConnections] = useState<ServerConnection[]>([]);
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({});
  const [origin, setOrigin] = useState("http://127.0.0.1:3773");
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [info, setInfo] = useState<string | undefined>(undefined);

  const refresh = async () => {
    const list = await sendRequest({ type: "connections.list" });
    setConnections(list.connections);
    setHealth(list.health);
  };

  useEffect(() => {
    void refresh();
    const listener = (event: ExtensionEvent) => {
      if (event.type === "connections.updated") void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    setInfo(undefined);
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
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(normalized)) {
        const granted = await chrome.permissions.request({ origins: [`${new URL(normalized).origin}/*`] });
        if (!granted)
          throw new Error("Ohne Zugriff auf diese Adresse kann die Extension den Server nicht erreichen.");
      }
      await sendRequest({ type: "connections.add", origin: normalized });
      setInfo("Server gefunden. Jetzt mit einem Pairing-Code koppeln.");
    });

  return (
    <div class="stack">
      <div class="card">
        <h2>T3-Code-Server hinzufügen</h2>
        <p class="muted">
          Die lokale Desktop-App läuft standardmäßig auf <code>http://127.0.0.1:3773</code>. Weitere Rechner
          (z. B. über Tailscale) lassen sich mit ihrer Adresse ergänzen; verlinkte Environments eines Servers
          werden automatisch mit angeboten.
        </p>
        <div class="row">
          <input
            class="input"
            value={origin}
            onInput={(e) => setOrigin((e.target as HTMLInputElement).value)}
            placeholder="http://127.0.0.1:3773"
          />
          <button type="button" class="btn primary fixed" disabled={busy === "add"} onClick={add}>
            {busy === "add" ? "Prüfe…" : "Hinzufügen"}
          </button>
        </div>
      </div>

      {error ? <div class="alert error">{error}</div> : null}
      {info ? <div class="alert success">{info}</div> : null}

      {connections.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          health={health[connection.id] ?? "unknown"}
          busy={busy}
          run={run}
        />
      ))}
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
  return (
    <div class="card">
      <div class="row">
        <div style="flex:1">
          <h2 style="margin:0">{connection.label}</h2>
          <div class="muted">
            {connection.origin}
            {connection.serverVersion ? ` · T3 Code ${connection.serverVersion}` : ""}
            {connection.environmentId ? ` · ${connection.environmentId.slice(0, 8)}…` : ""}
          </div>
        </div>
        <span class={`status ${health} fixed`}>{healthLabel(health)}</span>
        <button
          type="button"
          class="btn small fixed"
          disabled={busy === `probe:${id}`}
          onClick={() =>
            run(`probe:${id}`, async () => void (await sendRequest({ type: "connections.probe", id })))
          }
        >
          Prüfen
        </button>
      </div>

      {health !== "connected" ? (
        <div class="stack" style="border-top:1px solid var(--border);padding-top:10px">
          <h3>Koppeln</h3>
          <p class="muted">
            Erzeuge in T3 Code einen Pairing-Code (Settings → Connections → „Pair a client“) oder im Terminal
            mit <code>t3 auth pairing create --ttl 10m --label "Chrome"</code> und füge den Code hier ein. Die
            Verbindung erscheint danach in T3 unter Connections und kann dort jederzeit widerrufen werden.
          </p>
          <div class="row">
            <input
              class="input"
              placeholder="Pairing-Code"
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            />
            <select
              class="select"
              style="max-width:220px"
              value={access}
              onChange={(e) => setAccess((e.target as HTMLSelectElement).value as McpClientAccess)}
            >
              {ACCESS_LEVELS.map((level) => (
                <option key={level.value} value={level.value} title={level.hint}>
                  {level.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="btn primary fixed"
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
          <div>
            <button
              type="button"
              class="btn link"
              disabled={busy === `browser:${id}`}
              onClick={() =>
                run(
                  `browser:${id}`,
                  async () => void (await sendRequest({ type: "connections.pairInBrowser", id })),
                )
              }
            >
              Alternativ: im Browser über die Freigabeseite von T3 Code koppeln
            </button>
          </div>
        </div>
      ) : null}

      <div class="row" style="justify-content:flex-end">
        {health === "connected" ? (
          <button
            type="button"
            class="btn small fixed"
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
          class="btn small danger fixed"
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

function Templates() {
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
    setMessage("Vorlage gespeichert.");
  };

  const remove = async (template: PromptTemplate) => {
    const { templates: list } = await sendRequest({ type: "templates.delete", id: template.id });
    setTemplates(list);
    setMessage(template.builtin ? "Vorlage auf den Standard zurückgesetzt." : "Vorlage gelöscht.");
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(templates, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "t3-code-chrome-templates.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as PromptTemplate[];
      if (!Array.isArray(parsed)) throw new Error("Die Datei enthält keine Vorlagenliste.");
      const { templates: list } = await sendRequest({ type: "templates.import", templates: parsed });
      setTemplates(list);
      setMessage(`${parsed.length} Vorlagen importiert.`);
    } catch (e) {
      setMessage(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const newTemplate = () =>
    setEditing({
      id: `custom:${crypto.randomUUID().slice(0, 8)}`,
      name: "Neue Vorlage",
      body: "{{user.note}}\n\nPull Request: {{pr.url}}",
      builtin: false,
      defaultTarget: "new",
      preferWorktree: true,
    });

  return (
    <div class="stack">
      <div class="row">
        <p class="muted" style="flex:1">
          Platzhalter: <code>{"{{pr.url}}"}</code> <code>{"{{pr.number}}"}</code>{" "}
          <code>{"{{pr.title}}"}</code> <code>{"{{pr.owner}}"}</code> <code>{"{{pr.repo}}"}</code>{" "}
          <code>{"{{pr.headBranch}}"}</code> <code>{"{{pr.baseBranch}}"}</code> <code>{"{{pr.author}}"}</code>{" "}
          <code>{"{{selection}}"}</code> <code>{"{{user.note}}"}</code>
        </p>
        <button type="button" class="btn small fixed" onClick={newTemplate}>
          Neue Vorlage
        </button>
        <button type="button" class="btn small fixed" onClick={exportAll}>
          Exportieren
        </button>
        <label class="btn small fixed" style="cursor:pointer">
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
        <div class="card">
          <h2>{templates.some((t) => t.id === editing.id) ? "Vorlage bearbeiten" : "Neue Vorlage"}</h2>
          <label class="field">
            Name
            <input
              class="input"
              value={editing.name}
              onInput={(e) => setEditing({ ...editing, name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            Beschreibung
            <input
              class="input"
              value={editing.description ?? ""}
              onInput={(e) => setEditing({ ...editing, description: (e.target as HTMLInputElement).value })}
            />
          </label>
          <div class="row">
            <label class="field">
              Standard-Ziel
              <select
                class="select"
                value={editing.defaultTarget}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    defaultTarget: (e.target as HTMLSelectElement).value as "new" | "existing",
                  })
                }
              >
                <option value="new">Neue Session</option>
                <option value="existing">Bestehende Session</option>
              </select>
            </label>
            <label class="field">
              Sendemodus (bestehende Session)
              <select
                class="select"
                value={editing.defaultSendMode ?? ""}
                onChange={(e) => {
                  const value = (e.target as HTMLSelectElement).value as
                    | PromptTemplate["defaultSendMode"]
                    | "";
                  const next = { ...editing };
                  if (value) next.defaultSendMode = value;
                  else delete next.defaultSendMode;
                  setEditing(next);
                }}
              >
                <option value="">Standard</option>
                <option value="queue">Als nächsten Turn</option>
                <option value="steer">Sofort einsteuern</option>
                <option value="restart">Neu starten</option>
                <option value="auto">Automatisch</option>
              </select>
            </label>
          </div>
          <label class="field">
            Prompt
            <span class="hint">
              Verwendete Platzhalter: {listPlaceholders(editing.body).join(", ") || "keine"}
            </span>
            <textarea
              class="textarea"
              value={editing.body}
              onInput={(e) => setEditing({ ...editing, body: (e.target as HTMLTextAreaElement).value })}
            />
          </label>
          <div class="row" style="justify-content:flex-end">
            <button type="button" class="btn fixed" onClick={() => setEditing(undefined)}>
              Abbrechen
            </button>
            <button
              type="button"
              class="btn primary fixed"
              onClick={save}
              disabled={!editing.name.trim() || !editing.body.trim()}
            >
              Speichern
            </button>
          </div>
        </div>
      ) : null}

      <div class="list">
        {templates.map((template) => (
          <div class="item" key={template.id}>
            <div style="flex:1;min-width:0">
              <div class="title">
                {template.name} {template.builtin ? <span class="muted">(mitgeliefert)</span> : null}
              </div>
              <div class="muted">{template.description ?? ""}</div>
            </div>
            <button type="button" class="btn small fixed" onClick={() => setEditing({ ...template })}>
              Bearbeiten
            </button>
            <button type="button" class="btn small danger fixed" onClick={() => void remove(template)}>
              {template.builtin ? "Zurücksetzen" : "Löschen"}
            </button>
          </div>
        ))}
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
        <h2>Neue Sessions</h2>
        <label class="field">
          Standard-Modus
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
            <option value="full-access">Full access</option>
            <option value="auto">Auto</option>
            <option value="auto-accept-edits">Auto-accept edits</option>
            <option value="approval-required">Approval required</option>
          </select>
          <span class="hint">Kann nicht über das Zugriffslevel der Verbindung hinausgehen.</span>
        </label>
        <label class="field">
          Arbeitsverzeichnis
          <select
            class="select"
            value={settings.defaultWorkspace}
            onChange={(e) =>
              void update({ defaultWorkspace: (e.target as HTMLSelectElement).value as "root" | "worktree" })
            }
          >
            <option value="worktree">Neuer Worktree auf dem PR-Branch</option>
            <option value="root">Projekt-Checkout</option>
          </select>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.appendContextFooter}
            onChange={(e) => void update({ appendContextFooter: (e.target as HTMLInputElement).checked })}
          />
          <span>
            PR-Kontextzeile an jeden Prompt anhängen{" "}
            <span class="muted">(URL und Branch, damit der Agent die PR sicher findet)</span>
          </span>
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
          <span>Wenn eine Session auf eine Antwort wartet</span>
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
      <div class="card">
        <h2>Tastenkürzel</h2>
        <p>
          <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> öffnet das Panel auf einer PR-Seite. Änderbar unter{" "}
          <code>chrome://extensions/shortcuts</code>.
        </p>
      </div>
      {saved ? <div class="alert success">Gespeichert.</div> : null}
    </div>
  );
}
