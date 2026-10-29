import { ACTIVE_THREAD_STATUSES, type Job, type ThreadStatus } from "@shared/models";
import { type PrKey, prKeyEquals } from "@shared/prKey";
import type { Catalog } from "./catalog";
import { loadJobs, loadSettings, saveJobs } from "./storage";

const ALARM = "t3-jobs-poll";
const POLL_PERIOD_MINUTES = 0.5;
const MAX_JOBS = 60;
const WAIT_TIMEOUT_MS = 20_000;

interface ThreadReadResult {
  status?: ThreadStatus;
  thread?: { status?: ThreadStatus; latestRunId?: string };
  items?: Array<{ role?: string; type?: string; text?: string; content?: string; createdAt?: string }>;
  messages?: Array<{ role?: string; type?: string; text?: string; content?: string; createdAt?: string }>;
  runs?: Array<{ runId?: string; status?: string; error?: string }>;
}

/** Tracks dispatched threads and keeps their status fresh while the worker is awake or via alarms. */
export class JobTracker {
  private polling = false;
  private listeners = new Set<(jobs: Job[]) => void>();

  constructor(private readonly catalog: Catalog) {}

  onChange(listener: (jobs: Job[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(pr?: PrKey): Promise<Job[]> {
    const jobs = await loadJobs();
    const filtered = pr ? jobs.filter((job) => prKeyEquals(job.pr, pr)) : jobs;
    return filtered.sort((a, b) => b.startedAt - a.startedAt);
  }

  async add(job: Job): Promise<Job> {
    const jobs = (await loadJobs()).filter((existing) => existing.id !== job.id);
    jobs.unshift(job);
    await saveJobs(jobs.slice(0, MAX_JOBS));
    await this.ensureAlarm();
    this.emit(jobs);
    void this.refresh(job.id).catch(() => undefined);
    return job;
  }

  async dismiss(jobId: string): Promise<void> {
    const jobs = (await loadJobs()).filter((job) => job.id !== jobId);
    await saveJobs(jobs);
    this.emit(jobs);
  }

  private emit(jobs: Job[]): void {
    for (const listener of this.listeners) listener(jobs);
  }

  async ensureAlarm(): Promise<void> {
    const existing = await chrome.alarms.get(ALARM);
    if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: POLL_PERIOD_MINUTES });
  }

  async handleAlarm(name: string): Promise<void> {
    if (name !== ALARM) return;
    const jobs = await loadJobs();
    const active = jobs.filter((job) => ACTIVE_THREAD_STATUSES.has(job.status) || job.status === "idle");
    if (active.length === 0) {
      await chrome.alarms.clear(ALARM);
      return;
    }
    await this.pollAll();
  }

  async pollAll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const jobs = await loadJobs();
      for (const job of jobs) {
        if (!ACTIVE_THREAD_STATUSES.has(job.status) && job.status !== "idle") continue;
        await this.refresh(job.id).catch(() => undefined);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Re-read one job's thread. Uses t3_thread_wait with a short timeout to catch quick finishes. */
  async refresh(jobId: string): Promise<Job> {
    const jobs = await loadJobs();
    const index = jobs.findIndex((job) => job.id === jobId);
    const job = jobs[index];
    if (!job) throw new Error("Unknown job.");
    let next: Job = { ...job };
    try {
      const { target, transport } = await this.catalog.resolve(job.envKey);
      const envArgs = target.toolEnvironmentId ? { environmentId: target.toolEnvironmentId } : {};
      if (ACTIVE_THREAD_STATUSES.has(job.status) || job.status === "idle") {
        await transport
          .callTool<unknown>("t3_thread_wait", {
            ...envArgs,
            threadId: job.threadId,
            timeoutMs: WAIT_TIMEOUT_MS,
          })
          .catch(() => undefined);
      }
      const read = await transport.callTool<ThreadReadResult>("t3_thread_read", {
        ...envArgs,
        threadId: job.threadId,
        view: "messages",
        limit: 4,
        maxCharsPerItem: 800,
        runLimit: 1,
      });
      const status = read?.thread?.status ?? read?.status ?? job.status;
      const items = read?.items ?? read?.messages ?? [];
      const lastAssistant = [...items]
        .reverse()
        .find((item) => (item.role ?? item.type ?? "").toLowerCase().includes("assistant"));
      const lastRun = read?.runs?.[read.runs.length - 1];
      next = {
        ...next,
        status,
        updatedAt: Date.now(),
        ...(lastAssistant ? { lastReply: (lastAssistant.text ?? lastAssistant.content ?? "").trim() } : {}),
        ...(lastRun?.runId ? { lastRunId: lastRun.runId } : {}),
        ...(lastRun?.error ? { error: lastRun.error } : {}),
      };
      if (!ACTIVE_THREAD_STATUSES.has(status) && status !== "idle" && !next.finishedAt) {
        next.finishedAt = Date.now();
      }
      delete next.error;
      if (lastRun?.error) next.error = lastRun.error;
    } catch (error) {
      next = {
        ...next,
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    jobs[index] = next;
    await saveJobs(jobs);
    this.emit(jobs);
    await this.maybeNotify(job, next);
    return next;
  }

  private async maybeNotify(before: Job, after: Job): Promise<void> {
    if (before.status === after.status || after.notified) return;
    const settings = await loadSettings();
    const finished = !ACTIVE_THREAD_STATUSES.has(after.status) && after.status !== "idle";
    const waiting = after.status === "waiting";
    if (!(finished && settings.notifyOnFinish) && !(waiting && settings.notifyOnWaiting)) return;
    if (!chrome.notifications) return;
    const title = waiting ? "T3 Code wartet auf eine Antwort" : `T3 Code: ${labelForStatus(after.status)}`;
    try {
      await chrome.notifications.create(`job:${after.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("public/icons/icon-128.png"),
        title,
        message: after.threadTitle,
        contextMessage: `${after.pr.owner}/${after.pr.repo}#${after.pr.number}`,
      });
    } catch {
      // notifications are best effort
    }
    if (finished) {
      const jobs = await loadJobs();
      const index = jobs.findIndex((job) => job.id === after.id);
      const current = jobs[index];
      if (current) {
        jobs[index] = { ...current, notified: true };
        await saveJobs(jobs);
      }
    }
  }
}

export function labelForStatus(status: ThreadStatus): string {
  switch (status) {
    case "idle":
      return "Bereit";
    case "preparing":
    case "queued":
    case "starting":
      return "Startet";
    case "running":
      return "Läuft";
    case "waiting":
      return "Wartet auf Antwort";
    case "completed":
      return "Fertig";
    case "interrupted":
      return "Unterbrochen";
    case "failed":
      return "Fehlgeschlagen";
    case "cancelled":
      return "Abgebrochen";
    case "rolled_back":
      return "Zurückgerollt";
    default:
      return status;
  }
}
