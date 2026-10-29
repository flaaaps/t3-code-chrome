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

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  body: string;
  builtin: boolean;
  defaultTarget: "new" | "existing";
  defaultSendMode?: SendMode;
  /** Prefer a worktree on the PR head branch when creating a new thread. */
  preferWorktree?: boolean;
}

export interface PrContext extends PrKey {
  url: string;
  title: string;
  headBranch?: string;
  baseBranch?: string;
  author?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string;
  selection?: string;
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

export interface Job {
  id: string;
  clientRequestId: string;
  pr: PrKey;
  envKey: string;
  threadId: string;
  threadTitle: string;
  link: string;
  prompt: string;
  startedAt: number;
  updatedAt: number;
  status: ThreadStatus;
  lastReply?: string;
  lastRunId?: string;
  error?: string;
  finishedAt?: number;
  notified?: boolean;
}

export interface PrSuggestions {
  pr: PrKey;
  environments: EnvironmentRef[];
  defaultEnvKey?: string;
  projects: Project[];
  suggestedProjectId?: string;
  threads: ThreadSummary[];
  suggestedThreadId?: string;
  capabilities: Record<string, EnvironmentCapabilities>;
  jobs: Job[];
}

export interface ExtensionSettings {
  defaultRuntimeMode: RuntimeMode;
  defaultWorkspace: "root" | "worktree";
  defaultModelSelection?: ModelSelection;
  notifyOnFinish: boolean;
  notifyOnWaiting: boolean;
  appendContextFooter: boolean;
  openInAppAfterDispatch: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  defaultRuntimeMode: "full-access",
  defaultWorkspace: "worktree",
  notifyOnFinish: true,
  notifyOnWaiting: true,
  appendContextFooter: true,
  openInAppAfterDispatch: false,
};
