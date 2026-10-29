import { sendRequest } from "@shared/client";
import { ACTIVE_THREAD_STATUSES, type Job } from "@shared/models";
import { useState } from "preact/hooks";
import { relativeTime, StatusChip } from "./components";

export function JobList({ jobs, onChanged }: { jobs: Job[]; onChanged: (jobs: Job[]) => void }) {
  if (jobs.length === 0) return null;
  return (
    <div class="t3-section">
      <div class="t3-label">
        Sessions zu dieser PR <span class="hint">{jobs.length}</span>
      </div>
      <div class="t3-jobs">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, onChanged }: { job: Job; onChanged: (jobs: Job[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const active = ACTIVE_THREAD_STATUSES.has(job.status) || job.status === "idle";

  const refresh = async () => {
    setBusy(true);
    try {
      await sendRequest({ type: "jobs.refresh", jobId: job.id });
      const { jobs } = await sendRequest({ type: "jobs.list", pr: job.pr });
      onChanged(jobs);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    await sendRequest({ type: "jobs.dismiss", jobId: job.id });
    const { jobs } = await sendRequest({ type: "jobs.list", pr: job.pr });
    onChanged(jobs);
  };
  const open = async () => {
    await sendRequest({ type: "thread.open", envKey: job.envKey, threadId: job.threadId, link: job.link });
  };

  return (
    <div class="t3-job">
      <div class="head">
        <StatusChip status={job.status} />
        <span class="title" title={job.threadTitle}>
          {job.threadTitle}
        </span>
        <span class="t3-muted">{relativeTime(job.updatedAt)}</span>
      </div>
      {job.error ? <div class="t3-muted">⚠ {job.error}</div> : null}
      {job.lastReply ? (
        <>
          {showReply ? <div class="reply">{job.lastReply}</div> : null}
          <button type="button" class="t3-btn link" onClick={() => setShowReply((v) => !v)}>
            {showReply ? "Antwort ausblenden" : "Letzte Antwort anzeigen"}
          </button>
        </>
      ) : null}
      <div class="actions">
        <button type="button" class="t3-btn link" onClick={open}>
          In T3 öffnen
        </button>
        <button type="button" class="t3-btn link" onClick={refresh} disabled={busy}>
          {busy ? "Aktualisiere…" : "Aktualisieren"}
        </button>
        {!active ? (
          <button type="button" class="t3-btn link" onClick={dismiss}>
            Entfernen
          </button>
        ) : null}
      </div>
    </div>
  );
}
