import {
  ACTIVE_THREAD_STATUSES,
  type Job,
  type PendingQuestion,
  RUNNING_THREAD_STATUSES,
  type Session,
  type ThreadStatus,
  type ThreadSummary,
} from "@shared/models";
import { type PrKey, prKeyEquals, prKeyToString } from "@shared/prKey";
import { threadIsLinked } from "@shared/sort";
import type { Catalog, ThreadRead } from "./catalog";
import { loadJobs, loadSettings, saveJobs } from "./storage";

const ALARM = "t3-sessions-poll";
const ALARM_PERIOD_MINUTES = 0.5;
const LIVE_INTERVAL_MS = 5_000;
const WAIT_TIMEOUT_MS = 15_000;
const MAX_JOBS = 80;
const READ_TTL_MS = 12_000;

function isActive(status: ThreadStatus): boolean {
  return ACTIVE_THREAD_STATUSES.has(status) || status === "idle";
}

/**
 * Tracks threads the extension launched (jobs), merges them with threads T3 already links to a PR,
 * and keeps their status fresh: every 5 s while a panel or popup is open, every 30 s otherwise.
 */
export class SessionTracker {
  private listeners = new Set<(sessions: Session[]) => void>();
  private reads = new Map<string, { at: number; value: ThreadRead; pending?: PendingQuestion[] }>();
  private livePorts = 0;
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private knownPrs = new Map<string, PrKey>();

  constructor(private readonly catalog: Catalog) {}

  onChange(listener: (sessions: Session[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- live polling ----------------------------------------------------------

  setLive(delta: number): void {
    this.livePorts = Math.max(0, this.livePorts + delta);
    if (this.livePorts > 0) this.scheduleLive(0);
    else if (this.liveTimer) {
      clearTimeout(this.liveTimer);
      this.liveTimer = undefined;
    }
  }

  private scheduleLive(delay: number): void {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      this.liveTimer = undefined;
      void this.pollActive().finally(() => {
        if (this.livePorts > 0) this.scheduleLive(LIVE_INTERVAL_MS);
      });
    }, delay);
  }

  async ensureAlarm(): Promise<void> {
    const existing = await chrome.alarms.get(ALARM);
    if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
  }

  async handleAlarm(name: string): Promise<void> {
    if (name !== ALARM) return;
    const jobs = await loadJobs();
    if (!jobs.some((job) => !job.dismissed && isActive(job.status))) {
      await chrome.alarms.clear(ALARM);
      return;
    }
    await this.pollActive();
  }

  async pollActive(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const jobs = await loadJobs();
      let changed = false;
      for (const job of jobs) {
        if (job.dismissed || !isActive(job.status)) continue;
        const before = `${job.status}|${job.lastReply ?? ""}|${job.threadUpdatedAt ?? ""}`;
        const next = await this.refreshJob(job, { wait: true }).catch(() => job);
        if (`${next.status}|${next.lastReply ?? ""}|${next.threadUpdatedAt ?? ""}` !== before) changed = true;
      }
      if (changed) await this.emit();
    } finally {
      this.polling = false;
    }
  }

  // --- jobs ------------------------------------------------------------------

  async addJob(job: Job): Promise<void> {
    const jobs = (await loadJobs()).filter((existing) => existing.id !== job.id);
    jobs.unshift(job);
    await saveJobs(jobs.slice(0, MAX_JOBS));
    this.knownPrs.set(prKeyToString(job.pr), job.pr);
    await this.ensureAlarm();
    await this.emit();
    void this.refreshJob(job, { wait: false })
      .then(() => this.emit())
      .catch(() => undefined);
  }

  async dismiss(jobId: string): Promise<void> {
    const jobs = await loadJobs();
    const index = jobs.findIndex((job) => job.id === jobId);
    const job = jobs[index];
    if (job) {
      jobs[index] = { ...job, dismissed: true };
      await saveJobs(jobs);
    }
    await this.emit();
  }

  async jobForThread(envKey: string, threadId: string): Promise<Job | undefined> {
    return (await loadJobs()).find((job) => job.envKey === envKey && job.threadId === threadId);
  }

  /** Re-read one job's thread; optionally wait briefly for a run to finish first. */
  async refreshJob(job: Job, options: { wait: boolean }): Promise<Job> {
    let next: Job = { ...job };
    try {
      const { target, transport } = await this.catalog.resolve(job.envKey);
      const envArgs = target.toolEnvironmentId ? { environmentId: target.toolEnvironmentId } : {};
      if (options.wait && RUNNING_THREAD_STATUSES.has(job.status)) {
        await transport
          .callTool("t3_thread_wait", { ...envArgs, threadId: job.threadId, timeoutMs: WAIT_TIMEOUT_MS })
          .catch(() => undefined);
      }
      const read = await this.catalog.readThread(job.envKey, job.threadId);
      this.reads.set(job.threadId, { at: Date.now(), value: read });
      const status = read.status ?? job.status;
      next = {
        ...next,
        status,
        updatedAt: Date.now(),
        ...(read.updatedAt ? { threadUpdatedAt: read.updatedAt } : {}),
        ...(read.title ? { threadTitle: read.title } : {}),
        ...(read.lastAssistant ? { lastReply: read.lastAssistant.text } : {}),
        ...(read.lastAssistant?.at ? { lastReplyAt: read.lastAssistant.at } : {}),
        ...(read.lastRunId ? { lastRunId: read.lastRunId } : {}),
      };
      delete next.error;
      if (read.error) next.error = read.error;
      if (!isActive(status) && !next.finishedAt) next.finishedAt = Date.now();
      if (status === "waiting") {
        const pending = await this.catalog.pendingQuestions(job.envKey, job.threadId).catch(() => []);
        const cached = this.reads.get(job.threadId);
        if (cached) cached.pending = pending;
      }
    } catch (error) {
      next = {
        ...next,
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const jobs = await loadJobs();
    const index = jobs.findIndex((entry) => entry.id === job.id);
    if (index !== -1) {
      jobs[index] = next;
      await saveJobs(jobs);
    }
    await this.maybeNotify(job, next);
    return next;
  }

  /** Force a refresh of the thread behind a session, whether it is a job or a linked thread. */
  async refreshThread(envKey: string, threadId: string): Promise<void> {
    const job = await this.jobForThread(envKey, threadId);
    if (job) {
      await this.refreshJob(job, { wait: false });
    } else {
      const read = await this.catalog.readThread(envKey, threadId);
      const entry = { at: Date.now(), value: read } as {
        at: number;
        value: ThreadRead;
        pending?: PendingQuestion[];
      };
      if (read.status === "waiting") {
        entry.pending = await this.catalog.pendingQuestions(envKey, threadId).catch(() => []);
      }
      this.reads.set(threadId, entry);
    }
    await this.emit();
  }

  // --- sessions (view-model) ---------------------------------------------------

  /** Sessions for one PR: extension jobs plus threads T3 links to the PR, deduplicated. */
  async sessionsForPr(pr: PrKey, options: { refreshLinked?: boolean } = {}): Promise<Session[]> {
    this.knownPrs.set(prKeyToString(pr), pr);
    const jobs = (await loadJobs()).filter((job) => !job.dismissed && prKeyEquals(job.pr, pr));
    const sessions: Session[] = jobs.map((job) => this.sessionFromJob(job));
    const seen = new Set(sessions.map((session) => session.threadId));

    const environments = await this.catalog.listEnvironments().catch(() => []);
    const linked: ThreadSummary[] = [];
    for (const env of environments) {
      if (!env.reachable) continue;
      const threads = await this.catalog.listThreads(env.key, options.refreshLinked === true).catch(() => []);
      for (const thread of threads)
        if (!seen.has(thread.threadId) && threadIsLinked(thread, pr)) linked.push(thread);
    }
    linked.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const thread of linked.slice(0, 6)) {
      const read = await this.cachedRead(thread, options.refreshLinked === true);
      sessions.push(this.sessionFromThread(thread, pr, read));
    }
    sessions.sort(compareSessions);
    return sessions;
  }

  /** Everything the extension tracks, across PRs, for the popup inbox. */
  async inbox(): Promise<Session[]> {
    const jobs = (await loadJobs()).filter((job) => !job.dismissed);
    const sessions = jobs.map((job) => this.sessionFromJob(job));
    sessions.sort(compareSessions);
    return sessions;
  }

  private async cachedRead(thread: ThreadSummary, force: boolean) {
    const cached = this.reads.get(thread.threadId);
    const stale =
      !cached || Date.now() - cached.at > READ_TTL_MS || cached.value.updatedAt !== thread.updatedAt;
    if (cached && !force && !stale) return cached;
    try {
      const value = await this.catalog.readThread(thread.envKey, thread.threadId);
      const entry: { at: number; value: ThreadRead; pending?: PendingQuestion[] } = { at: Date.now(), value };
      if ((value.status ?? thread.status) === "waiting") {
        entry.pending = await this.catalog.pendingQuestions(thread.envKey, thread.threadId).catch(() => []);
      }
      this.reads.set(thread.threadId, entry);
      return entry;
    } catch {
      return cached;
    }
  }

  sessionFromJob(job: Job): Session {
    const read = this.reads.get(job.threadId);
    const lastReplyAt = job.lastReplyAt ?? read?.value.lastAssistant?.at;
    return {
      key: `job:${job.id}`,
      envKey: job.envKey,
      threadId: job.threadId,
      pr: job.pr,
      title: job.threadTitle,
      ...(job.intentName ? { intentName: job.intentName } : {}),
      status: job.status,
      link: job.link,
      ...(read?.value.model ? { model: read.value.model } : {}),
      ...(job.branch ? { branch: job.branch } : {}),
      updatedAt: job.threadUpdatedAt ?? new Date(job.updatedAt).toISOString(),
      ...(job.lastReply
        ? {
            lastMessage: {
              role: "assistant" as const,
              text: job.lastReply,
              ...(lastReplyAt ? { at: lastReplyAt } : {}),
            },
          }
        : {}),
      ...(read?.pending && read.pending.length > 0 ? { pending: read.pending } : {}),
      ...(job.error ? { error: job.error } : {}),
      jobId: job.id,
      source: "job",
    };
  }

  private sessionFromThread(
    thread: ThreadSummary,
    pr: PrKey,
    read: { value: ThreadRead; pending?: PendingQuestion[] } | undefined,
  ): Session {
    const last = read?.value.lastAssistant;
    return {
      key: `thread:${thread.threadId}`,
      envKey: thread.envKey,
      threadId: thread.threadId,
      pr,
      title: thread.title,
      status: read?.value.status ?? thread.status,
      link: thread.link,
      ...(thread.model ? { model: thread.model } : {}),
      updatedAt: read?.value.updatedAt ?? thread.updatedAt,
      ...(last
        ? {
            lastMessage: { role: "assistant" as const, text: last.text, ...(last.at ? { at: last.at } : {}) },
          }
        : {}),
      ...(read?.pending && read.pending.length > 0 ? { pending: read.pending } : {}),
      ...(read?.value.error ? { error: read.value.error } : {}),
      source: "linked",
    };
  }

  async emit(): Promise<void> {
    if (this.listeners.size === 0) return;
    const inbox = await this.inbox();
    for (const listener of this.listeners) listener(inbox);
  }

  private async maybeNotify(before: Job, after: Job): Promise<void> {
    if (before.status === after.status || after.notified) return;
    const settings = await loadSettings();
    const finished = !isActive(after.status);
    const waiting = after.status === "waiting";
    if (!(finished && settings.notifyOnFinish) && !(waiting && settings.notifyOnWaiting)) return;
    if (!chrome.notifications) return;
    const title = waiting ? "T3 Code wartet auf dich" : `T3 Code: ${labelForStatus(after.status)}`;
    const message = waiting
      ? (this.reads.get(after.threadId)?.pending?.[0]?.text ?? after.lastReply ?? after.threadTitle)
      : (after.lastReply ?? after.threadTitle);
    try {
      await chrome.notifications.create(`job:${after.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("public/icons/icon-128.png"),
        title,
        message: message.slice(0, 200),
        contextMessage: `${after.pr.owner}/${after.pr.repo}#${after.pr.number} · ${after.threadTitle}`,
      });
    } catch {
      // best effort
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

const STATUS_ORDER: Record<ThreadStatus, number> = {
  waiting: 0,
  running: 1,
  starting: 1,
  queued: 1,
  preparing: 1,
  idle: 2,
  completed: 3,
  interrupted: 3,
  failed: 3,
  cancelled: 3,
  rolled_back: 3,
};

export function compareSessions(a: Session, b: Session): number {
  const order = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
  if (order !== 0) return order;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function labelForStatus(status: ThreadStatus): string {
  switch (status) {
    case "idle":
      return "bereit";
    case "preparing":
    case "queued":
    case "starting":
      return "startet";
    case "running":
      return "läuft";
    case "waiting":
      return "wartet auf dich";
    case "completed":
      return "fertig";
    case "interrupted":
      return "unterbrochen";
    case "failed":
      return "fehlgeschlagen";
    case "cancelled":
      return "abgebrochen";
    case "rolled_back":
      return "verworfen";
    default:
      return status;
  }
}
