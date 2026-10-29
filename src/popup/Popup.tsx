import { type ExtensionEvent, sendRequest } from "@shared/client";
import {
  ACTIVE_THREAD_STATUSES,
  type ConnectionHealth,
  type Job,
  type ServerConnection,
} from "@shared/models";
import { parsePrUrl } from "@shared/prKey";
import { useEffect, useState } from "preact/hooks";

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

function statusLabel(status: string): string {
  switch (status) {
    case "waiting":
      return "wartet";
    case "running":
      return "läuft";
    case "completed":
      return "fertig";
    case "failed":
      return "Fehler";
    case "queued":
    case "starting":
    case "preparing":
      return "startet";
    default:
      return status;
  }
}

export function Popup() {
  const [connections, setConnections] = useState<ServerConnection[]>([]);
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [onPr, setOnPr] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = async () => {
    try {
      const [list, jobList] = await Promise.all([
        sendRequest({ type: "connections.list" }),
        sendRequest({ type: "jobs.list" }),
      ]);
      setConnections(list.connections);
      setHealth(list.health);
      setJobs(jobList.jobs);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setOnPr(!!tab?.url && !!parsePrUrl(tab.url)));
    const listener = (event: ExtensionEvent) => {
      if (event.type === "jobs.updated") setJobs(event.jobs);
      if (event.type === "connections.updated") void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const openPanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    const event: ExtensionEvent = { type: "panel.toggle" };
    await chrome.tabs.sendMessage(tab.id, event).catch(() => undefined);
    window.close();
  };

  const openPr = async (job: Job) => {
    const url = `https://${job.pr.host}/${job.pr.owner}/${job.pr.repo}/pull/${job.pr.number}`;
    const [existing] = await chrome.tabs.query({ url: `${url}*` });
    if (existing?.id !== undefined) await chrome.tabs.update(existing.id, { active: true });
    else await chrome.tabs.create({ url });
    window.close();
  };

  const active = jobs.filter((job) => ACTIVE_THREAD_STATUSES.has(job.status));
  const recent = jobs.filter((job) => !ACTIVE_THREAD_STATUSES.has(job.status)).slice(0, 5);

  return (
    <div class="stack">
      <div class="row">
        <h1 style="flex:1">T3 Code</h1>
        <button type="button" class="btn small fixed" onClick={() => chrome.runtime.openOptionsPage()}>
          Optionen
        </button>
      </div>

      {error ? <div class="alert error">{error}</div> : null}

      {connections.length === 0 ? (
        <div class="alert">
          Noch keine Verbindung zu T3 Code.{" "}
          <button type="button" class="btn link" onClick={() => chrome.runtime.openOptionsPage()}>
            Jetzt einrichten
          </button>
        </div>
      ) : (
        <div class="list">
          {connections.map((connection) => (
            <div class="item" key={connection.id}>
              <span class="title">{connection.label}</span>
              <span class={`status ${health[connection.id] ?? "unknown"}`}>
                {healthLabel(health[connection.id] ?? "unknown")}
              </span>
            </div>
          ))}
        </div>
      )}

      {onPr ? (
        <button type="button" class="btn primary" onClick={openPanel}>
          Panel auf dieser PR öffnen
        </button>
      ) : (
        <div class="muted">Öffne eine Pull Request auf github.com, um das Panel zu nutzen.</div>
      )}

      {active.length > 0 ? (
        <div class="stack">
          <h3>Aktive Sessions</h3>
          {active.map((job) => (
            <JobRow key={job.id} job={job} onOpen={openPr} />
          ))}
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div class="stack">
          <h3>Zuletzt</h3>
          {recent.map((job) => (
            <JobRow key={job.id} job={job} onOpen={openPr} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function JobRow({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  return (
    <div class="item">
      <div style="flex:1;min-width:0">
        <div class="title" title={job.threadTitle}>
          {job.threadTitle}
        </div>
        <div class="muted">
          {job.pr.owner}/{job.pr.repo}#{job.pr.number} · {statusLabel(job.status)}
        </div>
      </div>
      <button type="button" class="btn small fixed" onClick={() => onOpen(job)}>
        PR
      </button>
      <button
        type="button"
        class="btn small fixed"
        onClick={() =>
          void sendRequest({
            type: "thread.open",
            envKey: job.envKey,
            threadId: job.threadId,
            link: job.link,
          })
        }
      >
        T3
      </button>
    </div>
  );
}
