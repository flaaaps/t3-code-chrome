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
      return "verworfen";
    default:
      return status;
  }
}

export function statusTone(status: string): "running" | "waiting" | "done" | "failed" | "idle" {
  if (status === "waiting") return "waiting";
  if (["preparing", "queued", "starting", "running"].includes(status)) return "running";
  if (status === "completed") return "done";
  if (["failed", "cancelled", "interrupted", "rolled_back"].includes(status)) return "failed";
  return "idle";
}

export function StatusDot({ status }: { status: string }) {
  return <span class={`t3-dot ${statusTone(status)}`} aria-hidden="true" />;
}

export function StatusChip({ status, children }: { status: string; children?: ComponentChildren }) {
  return (
    <span class={`t3-status ${statusTone(status)}`}>
      <StatusDot status={status} />
      {children ?? statusLabel(status)}
    </span>
  );
}

export function Spinner({ label = "Lädt" }: { label?: string }) {
  return <span class="t3-spinner" role="status" aria-label={label} />;
}

export function Alert({
  kind = "info",
  children,
}: {
  kind?: "info" | "error" | "success";
  children: ComponentChildren;
}) {
  return (
    <div class={`t3-alert ${kind === "info" ? "" : kind}`} role={kind === "error" ? "alert" : undefined}>
      {children}
    </div>
  );
}

export function relativeTime(iso: string | number | undefined): string {
  if (iso === undefined) return "";
  const time = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diff = Date.now() - time;
  const seconds = Math.round(diff / 1000);
  if (seconds < 45) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} d`;
}

export function Icon({
  name,
  size = 16,
}: {
  name: "play" | "chevron" | "stop" | "send" | "close" | "t3" | "refresh" | "external" | "gear" | "bell";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "currentColor",
    "aria-hidden": true,
  } as const;
  switch (name) {
    case "play":
      return (
        <svg {...common}>
          <path d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="10" height="10" rx="1.5" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M1.5 1.6a.75.75 0 0 1 .8-.1l12.5 6a.75.75 0 0 1 0 1.35l-12.5 6a.75.75 0 0 1-1.04-.86L2.6 8.9 8 8 2.6 7.1 1.26 2.46a.75.75 0 0 1 .24-.86Z" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M8 2.5a5.5 5.5 0 1 0 5.2 3.7.75.75 0 1 1 1.42-.5A7 7 0 1 1 8 1a6.97 6.97 0 0 1 4.75 1.86V1.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.64A5.47 5.47 0 0 0 8 2.5Z" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .14.11.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.78 2.78 2 3.75 2Zm6.5-1h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V3.56L7.28 9.28a.75.75 0 0 1-1.06-1.06l5.72-5.72H10.25a.75.75 0 0 1 0-1.5Z" />
        </svg>
      );
    case "gear":
      return (
        <svg {...common}>
          <path d="M8 5.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5ZM6.75 8a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z" />
          <path d="M7.25 1h1.5l.4 1.9c.4.12.78.28 1.14.48l1.63-1.07 1.06 1.06-1.07 1.63c.2.36.36.74.48 1.14l1.9.4v1.5l-1.9.4c-.12.4-.28.78-.48 1.14l1.07 1.63-1.06 1.06-1.63-1.07c-.36.2-.74.36-1.14.48l-.4 1.9h-1.5l-.4-1.9a5.5 5.5 0 0 1-1.14-.48l-1.63 1.07-1.06-1.06 1.07-1.63a5.5 5.5 0 0 1-.48-1.14L1 8.75v-1.5l1.9-.4c.12-.4.28-.78.48-1.14L2.31 4.08l1.06-1.06 1.63 1.07c.36-.2.74-.36 1.14-.48L7.25 1Zm.75 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M8 16a2 2 0 0 0 1.98-1.75H6.02A2 2 0 0 0 8 16ZM3 6a5 5 0 0 1 10 0v2.9l1.2 2.4a.75.75 0 0 1-.67 1.1H2.47a.75.75 0 0 1-.67-1.1L3 8.9V6Z" />
        </svg>
      );
    case "t3":
      return (
        <svg {...common} viewBox="0 0 16 16">
          <rect width="16" height="16" rx="3.5" fill="#4f46e5" />
          <text
            x="8"
            y="8"
            dy="0.36em"
            text-anchor="middle"
            font-size="7.5"
            font-weight="700"
            fill="#fff"
            font-family="system-ui, sans-serif"
          >
            T3
          </text>
        </svg>
      );
  }
}
