import { z } from "zod";
import type { SerializedError } from "./errors";
import type {
  ConnectionHealth,
  ExtensionSettings,
  Job,
  LinkState,
  PendingQuestion,
  PrOverview,
  Project,
  PromptTemplate,
  ServerConnection,
  Session,
  ThreadSummary,
} from "./models";

const prKeySchema = z.object({
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
});

const commentSchema = z.object({
  author: z.string().optional(),
  file: z.string().optional(),
  line: z.string().optional(),
  url: z.string().optional(),
  text: z.string(),
});

const prContextSchema = prKeySchema.extend({
  url: z.string(),
  title: z.string(),
  description: z.string().optional(),
  headBranch: z.string().optional(),
  baseBranch: z.string().optional(),
  author: z.string().optional(),
  viewer: z.string().optional(),
  state: z.string().optional(),
  isDraft: z.boolean().optional(),
  reviewDecision: z.string().optional(),
  checksState: z.enum(["success", "failure", "pending", "unknown"]).optional(),
  failedChecks: z.array(z.string()).optional(),
  changedFilesCount: z.number().optional(),
  comment: commentSchema.optional(),
});

const modelSelectionSchema = z.object({
  instanceId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string(),
  options: z.array(z.object({ id: z.string(), value: z.unknown() })).optional(),
});

const runtimeModeSchema = z.enum(["approval-required", "auto-accept-edits", "auto", "full-access"]);
const sendModeSchema = z.enum(["auto", "queue", "steer", "restart"]);
const accessSchema = z.enum(["read-only", "approval-required", "auto-accept-edits", "auto", "full-access"]);

const targetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new"),
    envKey: z.string(),
    projectId: z.string().optional(),
    scratch: z.boolean().optional(),
    modelSelection: modelSelectionSchema.optional(),
    runtimeMode: runtimeModeSchema.optional(),
    interactionMode: z.enum(["default", "plan"]).optional(),
    workspace: z.union([
      z.object({ type: z.literal("root") }),
      z.object({
        type: z.literal("worktree"),
        baseRef: z.string(),
        branch: z.string().optional(),
        startFromOrigin: z.boolean().optional(),
      }),
    ]),
    title: z.string().optional(),
  }),
  z.object({
    kind: z.literal("existing"),
    envKey: z.string(),
    threadId: z.string(),
    sendMode: sendModeSchema,
  }),
]);

const templateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  actionLabel: z.string().optional(),
  description: z.string().optional(),
  body: z.string(),
  builtin: z.boolean(),
  defaultTarget: z.enum(["new", "existing"]),
  defaultSendMode: sendModeSchema.optional(),
  preferWorktree: z.boolean().optional(),
  requires: z.array(z.enum(["note", "comment"])).optional(),
  reviewOutput: z.boolean().optional(),
});

const settingsSchema = z.object({
  defaultRuntimeMode: runtimeModeSchema,
  defaultWorkspace: z.enum(["root", "worktree"]),
  defaultModelSelection: modelSelectionSchema.optional(),
  defaultReviewOutput: z.enum(["inline", "report"]),
  notifyOnFinish: z.boolean(),
  notifyOnWaiting: z.boolean(),
  appendContextFooter: z.boolean(),
  openInAppAfterDispatch: z.boolean(),
  dispatchDelaySeconds: z.number().int().min(0).max(30),
  enterpriseHosts: z.array(z.string()),
  lastPrUrl: z.string().optional(),
});

/** Requests the UI surfaces (content script, popup, options) send to the service worker. */
export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connections.list") }),
  z.object({ type: z.literal("connections.autoDetect") }),
  z.object({ type: z.literal("connections.add"), origin: z.string(), label: z.string().optional() }),
  z.object({ type: z.literal("connections.remove"), id: z.string() }),
  z.object({ type: z.literal("connections.probe"), id: z.string() }),
  z.object({
    type: z.literal("connections.pairWithCode"),
    id: z.string(),
    code: z.string(),
    access: accessSchema,
  }),
  z.object({ type: z.literal("connections.pairInBrowser"), id: z.string() }),
  z.object({ type: z.literal("connections.disconnect"), id: z.string() }),

  z.object({ type: z.literal("pr.overview"), pr: prKeySchema, force: z.boolean().optional() }),
  z.object({ type: z.literal("pr.sessions"), pr: prKeySchema, refresh: z.boolean().optional() }),
  z.object({
    type: z.literal("pr.dispatch"),
    pr: prContextSchema,
    target: targetSchema,
    prompt: z.string().min(1),
    title: z.string().optional(),
    intentId: z.string().optional(),
    intentName: z.string().optional(),
    clientRequestId: z.string().optional(),
  }),
  z.object({
    type: z.literal("project.create"),
    envKey: z.string(),
    pr: prKeySchema,
    destinationPath: z.string(),
    title: z.string().optional(),
  }),

  z.object({
    type: z.literal("session.reply"),
    envKey: z.string(),
    threadId: z.string(),
    message: z.string().min(1),
    mode: sendModeSchema.optional(),
    requestId: z.string().optional(),
  }),
  z.object({ type: z.literal("session.stop"), envKey: z.string(), threadId: z.string() }),
  z.object({ type: z.literal("session.refresh"), envKey: z.string(), threadId: z.string() }),
  z.object({ type: z.literal("session.dismiss"), jobId: z.string() }),
  z.object({ type: z.literal("sessions.inbox") }),

  z.object({
    type: z.literal("threads.search"),
    envKey: z.string(),
    query: z.string(),
    projectId: z.string().optional(),
  }),

  z.object({ type: z.literal("templates.list") }),
  z.object({ type: z.literal("templates.save"), template: templateSchema }),
  z.object({ type: z.literal("templates.delete"), id: z.string() }),
  z.object({ type: z.literal("templates.import"), templates: z.array(templateSchema) }),
  z.object({ type: z.literal("settings.get") }),
  z.object({ type: z.literal("settings.set"), settings: settingsSchema.partial() }),
  z.object({ type: z.literal("thread.open"), envKey: z.string(), threadId: z.string() }),
  z.object({ type: z.literal("options.open"), tab: z.string().optional() }),
  z.object({ type: z.literal("shortcut.get") }),
  z.object({ type: z.literal("shortcut.edit") }),
]);

export type ExtensionRequest = z.infer<typeof requestSchema>;
export type RequestType = ExtensionRequest["type"];
export type RequestOf<T extends RequestType> = Extract<ExtensionRequest, { type: T }>;

export interface ConnectionsListResult {
  connections: ServerConnection[];
  health: Record<string, ConnectionHealth>;
  link: LinkState;
}

export interface ResponseMap {
  "connections.list": ConnectionsListResult;
  "connections.autoDetect": { connection?: ServerConnection; health: ConnectionHealth };
  "connections.add": { connection: ServerConnection };
  "connections.remove": { ok: true };
  "connections.probe": { health: ConnectionHealth; connection: ServerConnection };
  "connections.pairWithCode": { connection: ServerConnection; health: ConnectionHealth };
  "connections.pairInBrowser": { connection: ServerConnection; health: ConnectionHealth };
  "connections.disconnect": { ok: true };
  "pr.overview": PrOverview;
  "pr.sessions": { sessions: Session[] };
  "pr.dispatch": { job: Job; session: Session };
  "project.create": { project: Project };
  "session.reply": { session: Session };
  "session.stop": { session: Session };
  "session.refresh": { session: Session };
  "session.dismiss": { ok: true };
  "sessions.inbox": { sessions: Session[] };
  "threads.search": { threads: ThreadSummary[] };
  "templates.list": { templates: PromptTemplate[] };
  "templates.save": { templates: PromptTemplate[] };
  "templates.delete": { templates: PromptTemplate[] };
  "templates.import": { templates: PromptTemplate[] };
  "settings.get": { settings: ExtensionSettings };
  "settings.set": { settings: ExtensionSettings };
  "thread.open": { ok: true; opened: "app" | "web" };
  "options.open": { ok: true };
  /** The key currently bound to the open-panel command; empty when unassigned. */
  "shortcut.get": { shortcut: string };
  "shortcut.edit": { ok: true };
}

export type ResponseOf<T extends RequestType> = ResponseMap[T];

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: SerializedError };

/** Events the service worker pushes to tabs and extension pages. */
export type ExtensionEvent =
  | { type: "sessions.updated"; sessions: Session[] }
  | { type: "connections.updated"; link: LinkState }
  | { type: "panel.toggle"; source?: "command" | "popup" }
  | { type: "panel.openWithSelection"; selection: string };

export type { PendingQuestion };
