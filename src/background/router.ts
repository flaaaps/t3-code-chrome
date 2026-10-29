import { ExtensionError, serializeError } from "@shared/errors";
import {
  type Envelope,
  type ExtensionRequest,
  type RequestOf,
  type RequestType,
  type ResponseOf,
  requestSchema,
  type ThreadMessagePreview,
} from "@shared/messages";
import type {
  EnvironmentCapabilities,
  ExtensionSettings,
  Job,
  PromptTemplate,
  PrSuggestions,
  ThreadSummary,
} from "@shared/models";
import { prKeyEquals } from "@shared/prKey";
import { matchProject, rankThreads, sortProjects } from "@shared/sort";
import { BUILTIN_TEMPLATES } from "@shared/templates/builtin";
import { defaultThreadTitle } from "@shared/templates/render";
import type { Catalog } from "./catalog";
import type { ConnectionManager } from "./connections";
import type { JobTracker } from "./jobs";
import { openThread } from "./openThread";
import { loadCustomTemplates, loadSettings, saveCustomTemplates, saveSettings } from "./storage";

export interface RouterDeps {
  connections: ConnectionManager;
  catalog: Catalog;
  jobs: JobTracker;
}

type Handlers = {
  [T in RequestType]: (request: RequestOf<T>, sender: chrome.runtime.MessageSender) => Promise<ResponseOf<T>>;
};

export function createHandlers({ connections, catalog, jobs }: RouterDeps): Handlers {
  async function allTemplates(): Promise<PromptTemplate[]> {
    const custom = await loadCustomTemplates();
    const overridden = new Set(custom.map((t) => t.id));
    return [...custom, ...BUILTIN_TEMPLATES.filter((t) => !overridden.has(t.id))];
  }

  async function defaultEnvKey(): Promise<string | undefined> {
    const environments = await catalog.listEnvironments();
    return (
      environments.find((env) => env.reachable && !env.linked)?.key ??
      environments.find((env) => env.reachable)?.key
    );
  }

  return {
    "connections.list": async () => ({
      connections: await connections.list(),
      health: await connections.healthMap(),
    }),
    "connections.add": async ({ origin, label }) => ({ connection: await connections.add(origin, label) }),
    "connections.remove": async ({ id }) => {
      await connections.remove(id);
      return { ok: true };
    },
    "connections.probe": async ({ id }) => connections.probe(id),
    "connections.pairWithCode": async ({ id, code, access }) => {
      const connection = await connections.pairWithCode(id, code, access);
      return { connection, health: connections.healthOf(id) };
    },
    "connections.pairInBrowser": async ({ id }) => {
      const connection = await connections.pairInBrowser(id);
      return { connection, health: connections.healthOf(id) };
    },
    "connections.disconnect": async ({ id }) => {
      await connections.disconnect(id);
      return { ok: true };
    },

    "pr.suggestions": async ({ pr, force }) => {
      const all = await connections.list();
      if (all.length === 0) {
        throw new ExtensionError(
          "unauthenticated",
          "Noch keine T3-Code-Verbindung eingerichtet. Öffne die Optionen der Extension.",
        );
      }
      // Make sure health is known before listing environments.
      await Promise.all(
        all.map((connection) =>
          force || connections.healthOf(connection.id) === "unknown"
            ? connections.probe(connection.id)
            : Promise.resolve(),
        ),
      );
      const environments = await catalog.listEnvironments(force);
      const reachable = environments.filter((env) => env.reachable);
      if (reachable.length === 0) {
        throw new ExtensionError(
          "unreachable",
          "Keine erreichbare T3-Code-Verbindung. Läuft die Desktop-App?",
        );
      }
      const projectsByEnv = await Promise.all(
        reachable.map((env) => catalog.listProjects(env.key, force).catch(() => [])),
      );
      const projects = projectsByEnv.flat();
      const suggestedProject = matchProject(projects, pr);
      const suggestedEnvKey = suggestedProject?.envKey ?? (await defaultEnvKey());

      const threadsByEnv = await Promise.all(
        reachable.map((env) => catalog.listThreads(env.key, force).catch(() => [])),
      );
      const threads = threadsByEnv.flat();
      const ranked = rankThreads(threads, pr, suggestedProject?.id);
      const capabilities: Record<string, EnvironmentCapabilities> = {};
      await Promise.all(
        reachable.map(async (env) => {
          try {
            capabilities[env.key] = await catalog.capabilitiesOf(env.key);
          } catch {
            // model list is optional
          }
        }),
      );
      const result: PrSuggestions = {
        pr,
        environments,
        ...(suggestedEnvKey ? { defaultEnvKey: suggestedEnvKey } : {}),
        projects: sortProjects(projects, suggestedProject?.id),
        ...(suggestedProject ? { suggestedProjectId: suggestedProject.id } : {}),
        threads: ranked.map((entry) => entry.thread),
        ...(ranked[0]?.reason === "linked-pr" ? { suggestedThreadId: ranked[0].thread.threadId } : {}),
        capabilities,
        jobs: await jobs.list(pr),
      };
      return result;
    },

    "pr.dispatch": async ({ pr, target, prompt, title, clientRequestId }) => {
      const requestId = clientRequestId ?? crypto.randomUUID();
      const { target: env, transport } = await catalog.resolve(target.envKey);
      const envArgs = env.toolEnvironmentId ? { environmentId: env.toolEnvironmentId } : {};
      const settings = await loadSettings();
      let threadId: string;
      let threadTitle: string;
      let link: string;
      let status: Job["status"] = "queued";

      if (target.kind === "new") {
        threadTitle = (title ?? target.title ?? defaultThreadTitle(pr)).trim();
        const workspaceStrategy =
          target.workspace.type === "worktree"
            ? {
                type: "worktree",
                baseRef: target.workspace.baseRef,
                ...(target.workspace.branch ? { branch: target.workspace.branch } : {}),
                startFromOrigin: target.workspace.startFromOrigin ?? true,
              }
            : { type: "root" };
        const args: Record<string, unknown> = {
          ...envArgs,
          clientRequestId: requestId,
          title: threadTitle,
          message: prompt,
          ...(target.scratch ? { scratch: true } : { projectId: target.projectId, workspaceStrategy }),
          runtimeMode: target.runtimeMode ?? settings.defaultRuntimeMode,
          interactionMode: target.interactionMode ?? "default",
          ...(target.modelSelection ? { modelSelection: target.modelSelection } : {}),
        };
        if (!target.scratch && !target.projectId) {
          throw new ExtensionError(
            "invalid_input",
            "Bitte ein Projekt auswählen oder „Ohne Projekt“ wählen.",
          );
        }
        const launched = await transport.callTool<{
          threadId?: string;
          thread?: { threadId?: string; link?: string; title?: string; status?: Job["status"] };
          link?: string;
          status?: Job["status"];
        }>("t3_thread_launch", args);
        threadId = launched.threadId ?? launched.thread?.threadId ?? "";
        if (!threadId)
          throw new ExtensionError("invalid_response", "T3 Code hat keine Thread-ID zurückgegeben.");
        link = launched.link ?? launched.thread?.link ?? `t3-thread://v2/${env.environmentId}/${threadId}`;
        status = launched.status ?? launched.thread?.status ?? "queued";
      } else {
        const known = (await catalog.listThreads(target.envKey)).find((t) => t.threadId === target.threadId);
        threadId = target.threadId;
        threadTitle = known?.title ?? title ?? target.threadId;
        link = known?.link ?? `t3-thread://v2/${env.environmentId}/${threadId}`;
        const sent = await transport.callTool<{
          status?: Job["status"];
          thread?: { status?: Job["status"] };
        }>("t3_thread_send", {
          ...envArgs,
          clientRequestId: requestId,
          threadId,
          message: prompt,
          mode: target.sendMode,
        });
        status = sent?.status ?? sent?.thread?.status ?? "queued";
      }

      catalog.invalidateThreads(target.envKey);
      const now = Date.now();
      const job: Job = {
        id: crypto.randomUUID(),
        clientRequestId: requestId,
        pr: { host: pr.host, owner: pr.owner, repo: pr.repo, number: pr.number },
        envKey: target.envKey,
        threadId,
        threadTitle,
        link,
        prompt,
        startedAt: now,
        updatedAt: now,
        status,
      };
      await jobs.add(job);
      if (settings.openInAppAfterDispatch) {
        void openThread(connections, env, threadId, link).catch(() => undefined);
      }
      return { job };
    },

    "threads.search": async ({ envKey, query, projectId }) => {
      const threads: ThreadSummary[] = await catalog.searchThreads(envKey, query, projectId);
      return { threads };
    },

    "threads.read": async ({ envKey, threadId }) => {
      const { raw } = await catalog.readThread(envKey, threadId);
      return summariseThreadRead(raw);
    },

    "jobs.list": async ({ pr }) => ({ jobs: await jobs.list(pr) }),
    "jobs.refresh": async ({ jobId }) => ({ job: await jobs.refresh(jobId) }),
    "jobs.dismiss": async ({ jobId }) => {
      await jobs.dismiss(jobId);
      return { ok: true };
    },

    "templates.list": async () => ({ templates: await allTemplates() }),
    "templates.save": async ({ template }) => {
      const custom = (await loadCustomTemplates()).filter((t) => t.id !== template.id);
      const builtin = BUILTIN_TEMPLATES.some((t) => t.id === template.id);
      custom.push({ ...template, builtin });
      await saveCustomTemplates(custom);
      return { templates: await allTemplates() };
    },
    "templates.delete": async ({ id }) => {
      await saveCustomTemplates((await loadCustomTemplates()).filter((t) => t.id !== id));
      return { templates: await allTemplates() };
    },
    "templates.import": async ({ templates }) => {
      const custom = await loadCustomTemplates();
      const map = new Map(custom.map((t) => [t.id, t]));
      for (const template of templates) {
        map.set(template.id, { ...template, builtin: BUILTIN_TEMPLATES.some((t) => t.id === template.id) });
      }
      await saveCustomTemplates([...map.values()]);
      return { templates: await allTemplates() };
    },

    "settings.get": async () => ({ settings: await loadSettings() }),
    "settings.set": async ({ settings }) => {
      const merged: ExtensionSettings = { ...(await loadSettings()), ...stripUndefined(settings) };
      await saveSettings(merged);
      return { settings: merged };
    },

    "thread.open": async ({ envKey, threadId, link }) => {
      const { target } = await catalog.resolve(envKey);
      const opened = await openThread(connections, target, threadId, link);
      return { ok: true, opened };
    },
    "options.open": async () => {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    },
  };
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function summariseThreadRead(raw: unknown): { messages: ThreadMessagePreview[]; status: string } {
  const data = (raw ?? {}) as {
    status?: string;
    thread?: { status?: string };
    items?: Array<Record<string, unknown>>;
    messages?: Array<Record<string, unknown>>;
  };
  const items = data.items ?? data.messages ?? [];
  const messages: ThreadMessagePreview[] = [];
  for (const item of items) {
    const roleRaw = String(item.role ?? item.type ?? item.kind ?? "").toLowerCase();
    const role: ThreadMessagePreview["role"] = roleRaw.includes("user")
      ? "user"
      : roleRaw.includes("assistant") || roleRaw.includes("agent")
        ? "assistant"
        : "system";
    const text = String(item.text ?? item.content ?? item.body ?? "").trim();
    if (!text) continue;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : undefined;
    messages.push({ role, text, ...(createdAt ? { createdAt } : {}) });
  }
  return { messages, status: data.thread?.status ?? data.status ?? "unknown" };
}

export function installRouter(deps: RouterDeps): void {
  const handlers = createHandlers(deps);
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) {
      // Not one of ours (events use a different shape); ignore.
      return false;
    }
    const request = parsed.data as ExtensionRequest;
    const handler = handlers[request.type] as (
      request: ExtensionRequest,
      sender: chrome.runtime.MessageSender,
    ) => Promise<unknown>;
    handler(request, sender)
      .then((data) => sendResponse({ ok: true, data } satisfies Envelope<unknown>))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: serializeError(error) } satisfies Envelope<never>),
      );
    return true;
  });
}

export { prKeyEquals };
