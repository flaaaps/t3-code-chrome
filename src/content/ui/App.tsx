import type { ExtensionEvent } from "@shared/client";
import { sendRequest } from "@shared/client";
import { ACTIVE_THREAD_STATUSES, type Job, type PrContext } from "@shared/models";
import { prKeyEquals } from "@shared/prKey";
import { useEffect, useState } from "preact/hooks";
import { Panel } from "./Panel";

export interface AppController {
  toggle: () => void;
  openWithSelection: (selection: string) => void;
}

export function App({
  pr,
  register,
  onJobsChanged,
}: {
  pr: PrContext;
  register: (controller: AppController) => void;
  onJobsChanged: (jobs: Job[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selection, setSelection] = useState<string | undefined>(undefined);
  const [selectionVersion, setSelectionVersion] = useState(0);

  useEffect(() => {
    register({
      toggle: () => setOpen((v) => !v),
      openWithSelection: (text) => {
        setSelection(text);
        setSelectionVersion((v) => v + 1);
        setOpen(true);
      },
    });
  }, [register]);

  useEffect(() => {
    const prKey = { host: pr.host, owner: pr.owner, repo: pr.repo, number: pr.number };
    void sendRequest({ type: "jobs.list", pr: prKey })
      .then(({ jobs }) => setJobs(jobs))
      .catch(() => undefined);
    const listener = (event: ExtensionEvent) => {
      if (event.type === "jobs.updated") {
        setJobs(event.jobs.filter((job) => prKeyEquals(job.pr, prKey)));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [pr.host, pr.owner, pr.repo, pr.number]);

  useEffect(() => {
    onJobsChanged(jobs);
  }, [jobs, onJobsChanged]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Panel
      pr={pr}
      open={open}
      {...(selection !== undefined ? { initialSelection: selection } : {})}
      selectionVersion={selectionVersion}
      jobs={jobs}
      onJobs={setJobs}
      onClose={() => setOpen(false)}
    />
  );
}

export function triggerState(jobs: Job[]): { count: number; state: "idle" | "running" | "waiting" } {
  const active = jobs.filter((job) => ACTIVE_THREAD_STATUSES.has(job.status));
  if (active.some((job) => job.status === "waiting")) return { count: active.length, state: "waiting" };
  if (active.length > 0) return { count: active.length, state: "running" };
  return { count: 0, state: "idle" };
}
