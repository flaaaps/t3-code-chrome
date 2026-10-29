import { z } from "zod";
import type { SerializedError } from "./errors";
import type {
  ConnectionHealth,
  EnvironmentCapabilities,
  ExtensionSettings,
  Job,
  PromptTemplate,
  PrSuggestions,
  ServerConnection,
  ThreadSummary,
} from "./models";

const prKeySchema = z.object({
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
});

const prContextSchema = prKeySchema.extend({
  url: z.string(),
  title: z.string(),
  headBranch: z.string().optional(),
  baseBranch: z.string().optional(),
  author: z.string().optional(),
  state: z.string().optional(),
  isDraft: z.boolean().optional(),
  reviewDecision: z.string().optional(),
  selection: z.string().optional(),
});

const modelSelectionSchema = z.object({
  instanceId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string(),
  options: z.array(z.object({ id: z.string(), value: z.unknown() })).optional(),
});

const runtimeModeSchema = z.enum(["approval-required", "auto-accept-edits", "auto", "full-access"]);
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
    sendMode: z.enum(["auto", "queue", "steer", "restart"]),
  }),
]);

const templateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  body: z.string(),
  builtin: z.boolean(),
  defaultTarget: z.enum(["new", "existing"]),
  defaultSendMode: z.enum(["auto", "queue", "steer", "restart"]).optional(),
  preferWorktree: z.boolean().optional(),
});

const settingsSchema = z.object({
  defaultRuntimeMode: runtimeModeSchema,
  defaultWorkspace: z.enum(["root", "worktree"]),
  defaultModelSelection: modelSelectionSchema.optional(),
  notifyOnFinish: z.boolean(),
  notifyOnWaiting: z.boolean(),
  appendContextFooter: z.boolean(),
  openInAppAfterDispatch: z.boolean(),
});

/** Requests the UI surfaces (content script, popup, options) send to the service worker. */
export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connections.list") }),
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
  z.object({ type: z.literal("pr.suggestions"), pr: prKeySchema, force: z.boolean().optional() }),
  z.object({
    type: z.literal("pr.dispatch"),
    pr: prContextSchema,
    target: targetSchema,
    prompt: z.string().min(1),
    title: z.string().optional(),
    clientRequestId: z.string().optional(),
  }),
  z.object({
    type: z.literal("threads.search"),
    envKey: z.string(),
    query: z.string(),
    projectId: z.string().optional(),
  }),
  z.object({
    type: z.literal("threads.read"),
    envKey: z.string(),
    threadId: z.string(),
    limit: z.number().int().optional(),
  }),
  z.object({ type: z.literal("jobs.list"), pr: prKeySchema.optional() }),
  z.object({ type: z.literal("jobs.refresh"), jobId: z.string() }),
  z.object({ type: z.literal("jobs.dismiss"), jobId: z.string() }),
  z.object({ type: z.literal("templates.list") }),
  z.object({ type: z.literal("templates.save"), template: templateSchema }),
  z.object({ type: z.literal("templates.delete"), id: z.string() }),
  z.object({ type: z.literal("templates.import"), templates: z.array(templateSchema) }),
  z.object({ type: z.literal("settings.get") }),
  z.object({ type: z.literal("settings.set"), settings: settingsSchema.partial() }),
  z.object({ type: z.literal("thread.open"), envKey: z.string(), threadId: z.string(), link: z.string() }),
  z.object({ type: z.literal("options.open") }),
]);

export type ExtensionRequest = z.infer<typeof requestSchema>;
export type RequestType = ExtensionRequest["type"];
export type RequestOf<T extends RequestType> = Extract<ExtensionRequest, { type: T }>;

export interface ThreadMessagePreview {
  role: "user" | "assistant" | "system";
  text: string;
  createdAt?: string;
}

export interface ResponseMap {
  "connections.list": { connections: ServerConnection[]; health: Record<string, ConnectionHealth> };
  "connections.add": { connection: ServerConnection };
  "connections.remove": { ok: true };
  "connections.probe": { health: ConnectionHealth; connection: ServerConnection };
  "connections.pairWithCode": { connection: ServerConnection; health: ConnectionHealth };
  "connections.pairInBrowser": { connection: ServerConnection; health: ConnectionHealth };
  "connections.disconnect": { ok: true };
  "pr.suggestions": PrSuggestions;
  "pr.dispatch": { job: Job };
  "threads.search": { threads: ThreadSummary[] };
  "threads.read": { messages: ThreadMessagePreview[]; status: string };
  "jobs.list": { jobs: Job[] };
  "jobs.refresh": { job: Job };
  "jobs.dismiss": { ok: true };
  "templates.list": { templates: PromptTemplate[] };
  "templates.save": { templates: PromptTemplate[] };
  "templates.delete": { templates: PromptTemplate[] };
  "templates.import": { templates: PromptTemplate[] };
  "settings.get": { settings: ExtensionSettings };
  "settings.set": { settings: ExtensionSettings };
  "thread.open": { ok: true; opened: "app" | "web" };
  "options.open": { ok: true };
}

export type ResponseOf<T extends RequestType> = ResponseMap[T];

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: SerializedError };

/** Events the service worker pushes to tabs and extension pages. */
export type ExtensionEvent =
  | { type: "jobs.updated"; jobs: Job[] }
  | { type: "connections.updated" }
  | { type: "panel.toggle" }
  | { type: "panel.openWithSelection"; selection: string }
  | { type: "capabilities.updated"; capabilities: Record<string, EnvironmentCapabilities> };
