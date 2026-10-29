import type { ThreadStatus } from "@shared/models";
import type { ComponentChildren } from "preact";

export function statusLabel(status: ThreadStatus | string): string {
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
      return "zurückgerollt";
    default:
      return status;
  }
}

export function StatusChip({ status, children }: { status: string; children?: ComponentChildren }) {
  return <span class={`t3-status ${status}`}>{children ?? statusLabel(status)}</span>;
}

export function Spinner() {
  return <span class="t3-spinner" role="status" aria-label="Lädt" />;
}

export function Alert({
  kind = "info",
  children,
}: {
  kind?: "info" | "error" | "success";
  children: ComponentChildren;
}) {
  return <div class={`t3-alert ${kind === "info" ? "" : kind}`}>{children}</div>;
}

export function relativeTime(iso: string | number): string {
  const time = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diff = Date.now() - time;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} d`;
}
