import type { PrKey } from "./prKey";

export type ThreadStatus =
  | "idle"
  | "preparing"
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "rolled_back";

export const ACTIVE_THREAD_STATUSES: ReadonlySet<ThreadStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export const RUNNING_THREAD_STATUSES: ReadonlySet<ThreadStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
]);

export function isActiveStatus(status: ThreadStatus | string): boolean {
  return ACTIVE_THREAD_STATUSES.has(status as ThreadStatus);
}

export type RuntimeMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type InteractionMode = "default" | "plan";
export type SendMode = "auto" | "queue" | "steer" | "restart";
export type McpClientAccess =
  | "read-only"
  | "approval-required"
  | "auto-accept-edits"
  | "auto"
  | "full-access";

export interface ModelSelection {
  instanceId?: string;
  provider?: string;
  model: string;
  options?: Array<{ id: string; value: unknown }>;
}

/** One T3 server the extension is connected to. */
export interface ServerConnection {
  id: string;
  origin: string;
  label: string;
  environmentId?: string;
  serverVersion?: string;
  clientId?: string;
  createdAt: number;
}

export interface ConnectionAuth {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  access: McpClientAccess;
}

export type ConnectionHealth = "connected" | "unauthenticated" | "unreachable" | "unknown";

/** Overall state of the extension's link to T3, derived from all connections. */
export type LinkState = "none" | "unpaired" | "offline" | "ready";

export interface EnvironmentRef {
  /** `${connectionId}` for the server itself, `${connectionId}:${environmentId}` for linked ones. */
  key: string;
  connectionId: string;
  environmentId: string;
  label: string;
  linked: boolean;
  reachable: boolean;
}

export interface Project {
  id: string;
  envKey: string;
  title: string;
  workspaceRoot: string;
  canonicalKey?: string;
  repoDisplayName?: string;
  defaultModelSelection?: ModelSelection | null;
  updatedAt: string;
}

export interface ThreadPullRequestRef {
  host: string;
  repository: string;
  number: number;
  url: string;
  state?: string;
}

export interface ThreadSummary {
  threadId: string;
  envKey: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  link: string;
  providerInstanceId?: string;
  model?: string;
  runtimeMode?: RuntimeMode;
  pullRequests: ThreadPullRequestRef[];
  settled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderModelOption {
  id: string;
  values: unknown[];
  default?: unknown;
}

export interface ProviderModel {
  id: string;
  label?: string;
  options: ProviderModelOption[];
}

export interface ProviderInfo {
  providerInstanceId: string;
  displayName: string;
  models: ProviderModel[];
}

export interface EnvironmentCapabilities {
  envKey: string;
  providers: ProviderInfo[];
  runtimeMode: RuntimeMode;
}

/** An "Aktion": an intent with a prompt template. */
export interface PromptTemplate {
  id: string;
  name: string;
  /** Short verb phrase for the header button, e.g. "Review starten". */
  actionLabel?: string;
  description?: string;
  body: string;
  builtin: boolean;
  defaultTarget: "new" | "existing";
  defaultSendMode?: SendMode;
  preferWorktree?: boolean;
  /** Variables that must be non-empty before the action can be sent. */
  requires?: Array<"note" | "comment">;
  /** Offers the "Inline-Kommentare / Nur Bericht" switch. */
  reviewOutput?: boolean;
}

export type ReviewOutput = "inline" | "report";

export interface CommentContext {
  author?: string;
  file?: string;
  line?: string;
  url?: string;
  text: string;
}

export interface PrContext extends PrKey {
  url: string;
  title: string;
  description?: string;
  headBranch?: string;
  baseBranch?: string;
  author?: string;
  viewer?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string;
  checksState?: "success" | "failure" | "pending" | "unknown";
  failedChecks?: string[];
  changedFilesCount?: number;
  comment?: CommentContext;
}

export interface TargetNew {
  kind: "new";
  envKey: string;
  projectId?: string;
  scratch?: boolean;
  modelSelection?: ModelSelection;
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  workspace:
    | { type: "root" }
    | { type: "worktree"; baseRef: string; branch?: string; startFromOrigin?: boolean };
  title?: string;
}

export interface TargetExisting {
  kind: "existing";
  envKey: string;
  threadId: string;
  sendMode: SendMode;
}

export type DispatchTarget = TargetNew | TargetExisting;

/** A thread the extension launched or messaged, persisted locally for tracking. */
export interface Job {
  id: string;
  clientRequestId: string;
  pr: PrKey;
  envKey: string;
  threadId: string;
  threadTitle: string;
  link: string;
  prompt: string;
  intentId?: string;
  intentName?: string;
  branch?: string;
  startedAt: number;
  updatedAt: number;
  /** Last activity reported by T3 for the thread (not the poll time). */
  threadUpdatedAt?: string;
  status: ThreadStatus;
  lastReply?: string;
  lastReplyAt?: string;
  lastRunId?: string;
  error?: string;
  finishedAt?: number;
  notified?: boolean;
  dismissed?: boolean;
}

export interface PendingQuestion {
  requestId: string;
  text: string;
  options?: string[];
  raw?: unknown;
}

/** View-model shown in the Agent-Box and the popup inbox: a job or a thread linked to the PR. */
export interface Session {
  key: string;
  envKey: string;
  threadId: string;
  pr: PrKey;
  title: string;
  intentName?: string;
  status: ThreadStatus;
  link: string;
  model?: string;
  branch?: string;
  updatedAt: string;
  lastMessage?: { role: "assistant" | "user"; text: string; at?: string };
  pending?: PendingQuestion[];
  error?: string;
  jobId?: string;
  source: "job" | "linked";
  optimistic?: boolean;
}

export interface Defaults {
  envKey?: string;
  projectId?: string;
  projectTitle?: string;
  workspace: "worktree" | "root";
  runtimeMode: RuntimeMode;
  modelLabel?: string;
}

export interface PrOverview {
  pr: PrKey;
  link: LinkState;
  environments: EnvironmentRef[];
  projects: Project[];
  suggestedProjectId?: string;
  threads: ThreadSummary[];
  capabilities: Record<string, EnvironmentCapabilities>;
  sessions: Session[];
  defaults: Defaults;
}

export interface ExtensionSettings {
  defaultRuntimeMode: RuntimeMode;
  defaultWorkspace: "root" | "worktree";
  defaultModelSelection?: ModelSelection;
  defaultReviewOutput: ReviewOutput;
  notifyOnFinish: boolean;
  notifyOnWaiting: boolean;
  appendContextFooter: boolean;
  openInAppAfterDispatch: boolean;
  /** Seconds the cancel toast stays before a one-click action is dispatched. */
  dispatchDelaySeconds: number;
  lastPrUrl?: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  defaultRuntimeMode: "full-access",
  defaultWorkspace: "worktree",
  defaultReviewOutput: "inline",
  notifyOnFinish: true,
  notifyOnWaiting: true,
  appendContextFooter: true,
  openInAppAfterDispatch: false,
  dispatchDelaySeconds: 5,
};

export const DEFAULT_LOCAL_ORIGIN = "http://127.0.0.1:3773";
