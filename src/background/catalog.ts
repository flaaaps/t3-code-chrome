import type {
  EnvironmentCapabilities,
  EnvironmentRef,
  PendingQuestion,
  Project,
  ProviderInfo,
  ThreadStatus,
  ThreadSummary,
} from "@shared/models";
import type { ConnectionManager } from "./connections";
import type { McpTransport } from "./mcp/transport";

const TTL_MS = 45_000;
const THREAD_PAGE = 100;
const MAX_THREAD_PAGES = 3;

interface RawProject {
  id: string;
  title: string;
  workspaceRoot: string;
  repositoryIdentity?: {
    canonicalKey?: string;
    displayName?: string;
    owner?: string;
    name?: string;
    locator?: { remoteUrl?: string };
  } | null;
  defaultModelSelection?: Project["defaultModelSelection"];
  updatedAt: string;
  deletedAt?: string | null;
}

interface RawThread {
  threadId: string;
  projectId: string;
  title: string;
  link?: string;
  status: ThreadStatus;
  providerInstanceId?: string;
  model?: string;
  runtimeMode?: ThreadSummary["runtimeMode"];
  pullRequests?: Array<{ host: string; repository: string; number: number; url: string; state?: string }>;
  linkedPullRequest?: {
    host: string;
    repository: string;
    number: number;
    url: string;
    state?: string;
  } | null;
  settled?: boolean;
  parentThreadId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Cached<T> {
  at: number;
  value: T;
}

export interface EnvironmentTarget {
  key: string;
  connectionId: string;
  environmentId: string;
  /** Pass to tools when talking to a linked environment through its host connection. */
  toolEnvironmentId?: string;
}

export function parseEnvKey(key: string): { connectionId: string; linkedEnvironmentId?: string } {
  const [connectionId, linkedEnvironmentId] = key.split(":", 2);
  return { connectionId: connectionId ?? key, ...(linkedEnvironmentId ? { linkedEnvironmentId } : {}) };
}

/** Caches environments, projects, threads and capabilities per environment. */
export class Catalog {
  private environments: Cached<EnvironmentRef[]> | undefined;
  private projects = new Map<string, Cached<Project[]>>();
  private threads = new Map<string, Cached<ThreadSummary[]>>();
  private capabilities = new Map<string, Cached<EnvironmentCapabilities>>();

  constructor(private readonly connections: ConnectionManager) {
    connections.onChange(() => this.invalidateAll());
  }

  invalidateAll(): void {
    this.environments = undefined;
    this.projects.clear();
    this.threads.clear();
    this.capabilities.clear();
  }

  invalidateThreads(envKey?: string): void {
    if (envKey) this.threads.delete(envKey);
    else this.threads.clear();
  }

  async resolve(envKey: string): Promise<{ target: EnvironmentTarget; transport: McpTransport }> {
    const { connectionId, linkedEnvironmentId } = parseEnvKey(envKey);
    const connection = await this.connections.get(connectionId);
    const transport = await this.connections.connectedTransport(connectionId);
    return {
      target: {
        key: envKey,
        connectionId,
        environmentId: linkedEnvironmentId ?? connection.environmentId ?? connectionId,
        ...(linkedEnvironmentId ? { toolEnvironmentId: linkedEnvironmentId } : {}),
      },
      transport,
    };
  }

  private envArgs(target: EnvironmentTarget): Record<string, unknown> {
    return target.toolEnvironmentId ? { environmentId: target.toolEnvironmentId } : {};
  }

  async listEnvironments(force = false): Promise<EnvironmentRef[]> {
    if (!force && this.environments && Date.now() - this.environments.at < TTL_MS)
      return this.environments.value;
    const connections = await this.connections.list();
    const refs: EnvironmentRef[] = [];
    await Promise.all(
      connections.map(async (connection) => {
        const health = this.connections.healthOf(connection.id);
        const reachable = health === "connected";
        refs.push({
          key: connection.id,
          connectionId: connection.id,
          environmentId: connection.environmentId ?? connection.id,
          label: connection.label,
          linked: false,
          reachable,
        });
        if (!reachable) return;
        try {
          const transport = await this.connections.connectedTransport(connection.id);
          const tools = await transport.listTools();
          const linkTool = tools.find((tool) => /^t3_environment_links?$/.test(tool.name));
          if (!linkTool) return;
          const result = await transport.callTool<{
            environments?: Array<{
              environmentId: string;
              label?: string;
              reachable?: boolean;
              connected?: boolean;
            }>;
            links?: Array<{
              environmentId: string;
              label?: string;
              reachable?: boolean;
              connected?: boolean;
            }>;
          }>(linkTool.name, {});
          const linked = result?.environments ?? result?.links ?? [];
          for (const env of linked) {
            if (!env.environmentId || env.environmentId === connection.environmentId) continue;
            refs.push({
              key: `${connection.id}:${env.environmentId}`,
              connectionId: connection.id,
              environmentId: env.environmentId,
              label: env.label ? `${env.label} (via ${connection.label})` : env.environmentId,
              linked: true,
              reachable: env.reachable ?? env.connected ?? true,
            });
          }
        } catch {
          // linked environments are optional
        }
      }),
    );
    refs.sort((a, b) => Number(a.linked) - Number(b.linked) || a.label.localeCompare(b.label));
    this.environments = { at: Date.now(), value: refs };
    return refs;
  }

  async listProjects(envKey: string, force = false): Promise<Project[]> {
    const cached = this.projects.get(envKey);
    if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const { target, transport } = await this.resolve(envKey);
    const projects: Project[] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page: { projects: RawProject[]; nextCursor: number | null } = await transport.callTool(
        "t3_project_list",
        {
          ...this.envArgs(target),
          cursor,
          limit: 100,
        },
      );
      for (const raw of page.projects ?? []) {
        if (raw.deletedAt) continue;
        // T3's own scratch folder is offered separately as "Ohne Projekt".
        if (!raw.repositoryIdentity && /[\\/]\.t3[\\/]scratch$/.test(raw.workspaceRoot)) continue;
        const identity = raw.repositoryIdentity ?? undefined;
        const canonicalKey = identity?.canonicalKey ?? identity?.locator?.remoteUrl;
        projects.push({
          id: raw.id,
          envKey,
          title: raw.title,
          workspaceRoot: raw.workspaceRoot,
          ...(canonicalKey ? { canonicalKey } : {}),
          ...(identity?.displayName ? { repoDisplayName: identity.displayName } : {}),
          defaultModelSelection: raw.defaultModelSelection ?? null,
          updatedAt: raw.updatedAt,
        });
      }
      cursor =
        typeof page.nextCursor === "number" && (page.projects?.length ?? 0) > 0 ? page.nextCursor : null;
      if (projects.length >= 500) break;
    }
    this.projects.set(envKey, { at: Date.now(), value: projects });
    return projects;
  }

  async listThreads(envKey: string, force = false): Promise<ThreadSummary[]> {
    const cached = this.threads.get(envKey);
    if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const { target, transport } = await this.resolve(envKey);
    const threads: ThreadSummary[] = [];
    let cursor: number | null = 0;
    let pages = 0;
    while (cursor !== null && pages < MAX_THREAD_PAGES) {
      pages += 1;
      const page: { threads: RawThread[]; nextCursor: number | null } = await transport.callTool(
        "t3_thread_list",
        {
          ...this.envArgs(target),
          allProjects: true,
          includeSubagents: false,
          cursor,
          limit: THREAD_PAGE,
        },
      );
      for (const raw of page.threads ?? []) {
        if (raw.parentThreadId) continue;
        threads.push(toThreadSummary(raw, envKey, target.environmentId));
      }
      cursor =
        typeof page.nextCursor === "number" && (page.threads?.length ?? 0) > 0 ? page.nextCursor : null;
    }
    this.threads.set(envKey, { at: Date.now(), value: threads });
    return threads;
  }

  async searchThreads(envKey: string, query: string, projectId?: string): Promise<ThreadSummary[]> {
    const { target, transport } = await this.resolve(envKey);
    const result = await transport.callTool<{ threads?: RawThread[]; results?: RawThread[] }>(
      "t3_thread_search",
      {
        ...this.envArgs(target),
        query,
        limit: 25,
        ...(projectId ? { projectId } : {}),
      },
    );
    const raw = result?.threads ?? result?.results ?? [];
    return raw.map((thread) => toThreadSummary(thread, envKey, target.environmentId));
  }

  /** Read a thread's state and last messages in a shape the UI can use. */
  async readThread(envKey: string, threadId: string): Promise<ThreadRead> {
    const { target, transport } = await this.resolve(envKey);
    const raw = await transport.callTool<Record<string, unknown>>("t3_thread_read", {
      ...this.envArgs(target),
      threadId,
      view: "messages",
      limit: 6,
      maxCharsPerItem: 1500,
      runLimit: 2,
    });
    return parseThreadRead(raw ?? {});
  }

  async pendingQuestions(envKey: string, threadId: string): Promise<PendingQuestion[]> {
    const { target, transport } = await this.resolve(envKey);
    const listed = await transport.callTool<Record<string, unknown>>("t3_pending_request", {
      ...this.envArgs(target),
      threadId,
      action: "list",
    });
    const ids = extractRequestIds(listed);
    const questions: PendingQuestion[] = [];
    for (const requestId of ids.slice(0, 3)) {
      try {
        const detail = await transport.callTool<Record<string, unknown>>("t3_pending_request", {
          ...this.envArgs(target),
          threadId,
          action: "read",
          requestId,
        });
        questions.push(parsePendingQuestion(requestId, detail));
      } catch {
        questions.push({ requestId, text: "Der Agent wartet auf eine Antwort." });
      }
    }
    return questions;
  }

  async respondToQuestion(
    envKey: string,
    threadId: string,
    question: PendingQuestion,
    answer: string,
  ): Promise<void> {
    const { target, transport } = await this.resolve(envKey);
    const answers = buildAnswers(question, answer);
    await transport.callTool("t3_pending_request", {
      ...this.envArgs(target),
      threadId,
      action: "respond",
      requestId: question.requestId,
      answers,
    });
  }

  async createProjectFromRepo(
    envKey: string,
    repo: { owner: string; name: string; host: string },
    destinationPath: string,
    title?: string,
  ): Promise<Project> {
    const { target, transport } = await this.resolve(envKey);
    await transport.callTool("t3_project_clone", {
      ...this.envArgs(target),
      destinationPath,
      remoteUrl: `https://${repo.host}/${repo.owner}/${repo.name}.git`,
      protocol: "auto",
    });
    const created = await transport.callTool<{ project?: RawProject; id?: string; title?: string }>(
      "t3_project_create",
      {
        ...this.envArgs(target),
        title: title ?? repo.name,
        workspaceRoot: destinationPath,
      },
    );
    this.projects.delete(envKey);
    const projects = await this.listProjects(envKey, true);
    const id = created?.project?.id ?? created?.id;
    const project =
      projects.find((p) => p.id === id) ?? projects.find((p) => p.workspaceRoot === destinationPath);
    if (!project) throw new Error("Das Projekt wurde angelegt, konnte aber nicht geladen werden.");
    return project;
  }

  async capabilitiesOf(envKey: string, force = false): Promise<EnvironmentCapabilities> {
    const cached = this.capabilities.get(envKey);
    if (!force && cached && Date.now() - cached.at < 10 * TTL_MS) return cached.value;
    const { target, transport } = await this.resolve(envKey);
    const result = await transport.callTool<{
      providers?: Array<{
        providerInstanceId: string;
        displayName?: string;
        models?: Array<{ id: string; label?: string; options?: ProviderInfo["models"][number]["options"] }>;
      }>;
      runtimeMode?: EnvironmentCapabilities["runtimeMode"];
    }>("orchestrator_capabilities", { ...this.envArgs(target) });
    const value: EnvironmentCapabilities = {
      envKey,
      runtimeMode: result?.runtimeMode ?? "full-access",
      providers: (result?.providers ?? []).map((provider) => ({
        providerInstanceId: provider.providerInstanceId,
        displayName: provider.displayName ?? provider.providerInstanceId,
        models: (provider.models ?? []).map((model) => ({
          id: model.id,
          ...(model.label ? { label: model.label } : {}),
          options: model.options ?? [],
        })),
      })),
    };
    this.capabilities.set(envKey, { at: Date.now(), value });
    return value;
  }
}

export function toThreadSummary(raw: RawThread, envKey: string, environmentId: string): ThreadSummary {
  const pullRequests = [...(raw.pullRequests ?? [])];
  if (raw.linkedPullRequest && !pullRequests.some((p) => p.url === raw.linkedPullRequest?.url)) {
    pullRequests.push(raw.linkedPullRequest);
  }
  return {
    threadId: raw.threadId,
    envKey,
    projectId: raw.projectId,
    title: raw.title,
    status: raw.status,
    link: raw.link ?? `t3-thread://v2/${environmentId}/${raw.threadId}`,
    ...(raw.providerInstanceId ? { providerInstanceId: raw.providerInstanceId } : {}),
    ...(raw.model ? { model: raw.model } : {}),
    ...(raw.runtimeMode ? { runtimeMode: raw.runtimeMode } : {}),
    pullRequests: pullRequests.map((p) => ({
      host: p.host,
      repository: p.repository,
      number: p.number,
      url: p.url,
      ...(p.state ? { state: p.state } : {}),
    })),
    settled: raw.settled ?? false,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export interface ThreadRead {
  status?: ThreadStatus;
  updatedAt?: string;
  title?: string;
  model?: string;
  lastAssistant?: { text: string; at?: string };
  lastUser?: { text: string; at?: string };
  lastRunId?: string;
  error?: string;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

function itemText(item: Record<string, unknown>): string {
  const direct = str(item.text) ?? str(item.content) ?? str(item.body) ?? str(item.message);
  if (direct) return direct;
  const content = item.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (str((part as Record<string, unknown>)?.text) ?? "")))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function itemRole(item: Record<string, unknown>): "assistant" | "user" | "other" {
  const role = String(item.role ?? item.type ?? item.kind ?? item.author ?? "").toLowerCase();
  if (role.includes("assistant") || role.includes("agent")) return "assistant";
  if (role.includes("user")) return "user";
  return "other";
}

export function parseThreadRead(raw: Record<string, unknown>): ThreadRead {
  const thread = (raw.thread ?? {}) as Record<string, unknown>;
  const items = (raw.items ?? raw.messages ?? []) as Array<Record<string, unknown>>;
  const runs = (raw.runs ?? thread.runs ?? []) as Array<Record<string, unknown>>;
  const result: ThreadRead = {};
  const status = str(thread.status) ?? str(raw.status);
  if (status) result.status = status as ThreadStatus;
  const updatedAt = str(thread.updatedAt) ?? str(raw.updatedAt);
  if (updatedAt) result.updatedAt = updatedAt;
  const title = str(thread.title) ?? str(raw.title);
  if (title) result.title = title;
  const model = str(thread.model) ?? str(raw.model);
  if (model) result.model = model;
  for (const item of items) {
    const role = itemRole(item);
    const text = itemText(item).trim();
    if (!text) continue;
    const at = str(item.createdAt) ?? str(item.updatedAt) ?? str(item.timestamp);
    const entry = { text, ...(at ? { at } : {}) };
    if (role === "assistant") result.lastAssistant = entry;
    if (role === "user") result.lastUser = entry;
  }
  const lastRun = runs[runs.length - 1];
  if (lastRun) {
    const runId = str(lastRun.runId) ?? str(lastRun.id);
    if (runId) result.lastRunId = runId;
    const error = str(lastRun.error) ?? str((lastRun.error as Record<string, unknown> | undefined)?.message);
    if (error) result.error = error;
  }
  return result;
}

function extractRequestIds(listed: Record<string, unknown> | undefined): string[] {
  if (!listed) return [];
  const candidates = (listed.requests ?? listed.pending ?? listed.items ?? listed.questions ?? []) as unknown;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : (str((entry as Record<string, unknown>).requestId) ?? str((entry as Record<string, unknown>).id)),
    )
    .filter((id): id is string => !!id);
}

function parsePendingQuestion(requestId: string, detail: Record<string, unknown>): PendingQuestion {
  const request = (detail.request ?? detail) as Record<string, unknown>;
  const questions = (request.questions ?? detail.questions) as Array<Record<string, unknown>> | undefined;
  const first = questions?.[0];
  const text =
    str(first?.question) ??
    str(first?.text) ??
    str(first?.prompt) ??
    str(request.question) ??
    str(request.text) ??
    str(request.prompt) ??
    str(request.message) ??
    "Der Agent wartet auf eine Antwort.";
  const optionsRaw = (first?.options ?? request.options) as unknown;
  const options = Array.isArray(optionsRaw)
    ? optionsRaw
        .map((option) =>
          typeof option === "string"
            ? option
            : (str((option as Record<string, unknown>).label) ??
              str((option as Record<string, unknown>).value)),
        )
        .filter((option): option is string => !!option)
    : undefined;
  return { requestId, text, ...(options && options.length > 0 ? { options } : {}), raw: detail };
}

function buildAnswers(question: PendingQuestion, answer: string): Record<string, unknown> {
  const detail = (question.raw ?? {}) as Record<string, unknown>;
  const request = (detail.request ?? detail) as Record<string, unknown>;
  const questions = (request.questions ?? detail.questions) as Array<Record<string, unknown>> | undefined;
  const key =
    str(questions?.[0]?.id) ??
    str(questions?.[0]?.key) ??
    str(questions?.[0]?.header) ??
    str(questions?.[0]?.question);
  if (key) return { [key]: answer };
  return { answer };
}
