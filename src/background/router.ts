import { ExtensionError, serializeError } from "@shared/errors";
import {
  type Envelope,
  type ExtensionRequest,
  type RequestOf,
  type RequestType,
  type ResponseOf,
  requestSchema,
} from "@shared/messages";
import type {
  Defaults,
  EnvironmentCapabilities,
  ExtensionSettings,
  Job,
  PrOverview,
  PromptTemplate,
  Session,
} from "@shared/models";
import { matchProject, rankThreads, sortProjects } from "@shared/sort";
import { BUILTIN_TEMPLATES } from "@shared/templates/builtin";
import { defaultThreadTitle } from "@shared/templates/render";
import type { Catalog } from "./catalog";
import type { ConnectionManager } from "./connections";
import { openThread } from "./openThread";
import type { SessionTracker } from "./sessions";
import { loadCustomTemplates, loadSettings, saveCustomTemplates, saveSettings } from "./storage";

export interface RouterDeps {
  connections: ConnectionManager;
  catalog: Catalog;
  sessions: SessionTracker;
}

type Handlers = {
  [T in RequestType]: (request: RequestOf<T>, sender: chrome.runtime.MessageSender) => Promise<ResponseOf<T>>;
};

export function createHandlers({ connections, catalog, sessions }: RouterDeps): Handlers {
  async function allTemplates(): Promise<PromptTemplate[]> {
    const custom = await loadCustomTemplates();
    const overridden = new Map(custom.map((t) => [t.id, t]));
    const builtins = BUILTIN_TEMPLATES.map((t) => overridden.get(t.id) ?? t);
    const extras = custom.filter((t) => !BUILTIN_TEMPLATES.some((b) => b.id === t.id));
    return [...builtins, ...extras];
  }

  /** Make sure every connection has a known health, then require at least one usable server. */
  async function requireLink(force: boolean): Promise<void> {
    const all = await connections.list();
    if (all.length === 0) {
      const detected = await connections.autoDetectLocal();
      if (!detected) {
        throw new ExtensionError("no_connection", "T3 Code ist noch nicht eingerichtet.");
      }
    }
    const list = await connections.list();
    await Promise.all(
      list.map((connection) =>
        force || connections.healthOf(connection.id) === "unknown"
          ? connections.probe(connection.id)
          : Promise.resolve(),
      ),
    );
    const link = await connections.linkState();
    if (link === "ready") return;
    if (link === "unpaired")
      throw new ExtensionError("unpaired", "T3 Code läuft, ist aber noch nicht gekoppelt.");
    throw new ExtensionError("unreachable", "T3 Code antwortet nicht. Läuft die Desktop-App?");
  }

  async function sessionFor(envKey: string, threadId: string): Promise<Session> {
    await sessions.refreshThread(envKey, threadId);
    const job = await sessions.jobForThread(envKey, threadId);
    if (job) return sessions.sessionFromJob(job);
    const all = await sessions.inbox();
    const found = all.find((s) => s.threadId === threadId);
    if (found) return found;
    throw new ExtensionError("not_found", "Session nicht gefunden.");
  }

  return {
    "connections.list": async () => ({
      connections: await connections.list(),
      health: await connections.healthMap(),
      link: await connections.linkState(),
    }),
    "connections.autoDetect": async () => {
      const connection = await connections.autoDetectLocal();
      if (!connection) return { health: "unreachable" as const };
      const probed = await connections.probe(connection.id);
      return { connection: probed.connection, health: probed.health };
    },
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

    "pr.overview": async ({ pr, force }) => {
      await requireLink(force === true);
      const settings = await loadSettings();
      const environments = await catalog.listEnvironments(force === true);
      const reachable = environments.filter((env) => env.reachable);
      const projects = (
        await Promise.all(
          reachable.map((env) => catalog.listProjects(env.key, force === true).catch(() => [])),
        )
      ).flat();
      const suggestedProject = matchProject(projects, pr);
      const envKey =
        suggestedProject?.envKey ?? reachable.find((env) => !env.linked)?.key ?? reachable[0]?.key;
      const threads = (
        await Promise.all(
          reachable.map((env) => catalog.listThreads(env.key, force === true).catch(() => [])),
        )
      ).flat();
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
      const modelLabel = (() => {
        const selection = suggestedProject?.defaultModelSelection ?? settings.defaultModelSelection;
        if (!selection) return undefined;
        const provider = envKey
          ? capabilities[envKey]?.providers.find((p) => p.providerInstanceId === selection.instanceId)
          : undefined;
        return provider?.models.find((m) => m.id === selection.model)?.label ?? selection.model;
      })();
      const defaults: Defaults = {
        ...(envKey ? { envKey } : {}),
        ...(suggestedProject ? { projectId: suggestedProject.id, projectTitle: suggestedProject.title } : {}),
        workspace: settings.defaultWorkspace,
        runtimeMode: settings.defaultRuntimeMode,
        ...(modelLabel ? { modelLabel } : {}),
      };
      const overview: PrOverview = {
        pr,
        link: "ready",
        environments,
        projects: sortProjects(projects, suggestedProject?.id),
        ...(suggestedProject ? { suggestedProjectId: suggestedProject.id } : {}),
        threads: ranked.map((entry) => entry.thread),
        capabilities,
        sessions: await sessions.sessionsForPr(pr, { refreshLinked: force === true }),
        defaults,
      };
      return overview;
    },

    "pr.sessions": async ({ pr, refresh }) => ({
      sessions: await sessions.sessionsForPr(pr, { refreshLinked: refresh === true }),
    }),

    "pr.dispatch": async ({ pr, target, prompt, title, intentId, intentName, clientRequestId }) => {
      const requestId = clientRequestId ?? crypto.randomUUID();
      const { target: env, transport } = await catalog.resolve(target.envKey);
      const envArgs = env.toolEnvironmentId ? { environmentId: env.toolEnvironmentId } : {};
      const settings = await loadSettings();
      let threadId: string;
      let threadTitle: string;
      let link: string;
      let status: Job["status"] = "queued";

      if (target.kind === "new") {
        threadTitle = (title ?? target.title ?? defaultThreadTitle(pr, intentName)).trim();
        if (!target.scratch && !target.projectId) {
          throw new ExtensionError("invalid_input", "Bitte ein Projekt wählen oder ohne Projekt starten.");
        }
        const workspaceStrategy =
          target.workspace.type === "worktree"
            ? {
                type: "worktree",
                baseRef: target.workspace.baseRef,
                ...(target.workspace.branch ? { branch: target.workspace.branch } : {}),
                startFromOrigin: target.workspace.startFromOrigin ?? true,
              }
            : { type: "root" };
        const launched = await transport.callTool<{
          threadId?: string;
          thread?: { threadId?: string; link?: string; status?: Job["status"] };
          link?: string;
          status?: Job["status"];
        }>("t3_thread_launch", {
          ...envArgs,
          clientRequestId: requestId,
          title: threadTitle,
          message: prompt,
          ...(target.scratch ? { scratch: true } : { projectId: target.projectId, workspaceStrategy }),
          runtimeMode: target.runtimeMode ?? settings.defaultRuntimeMode,
          interactionMode: target.interactionMode ?? "default",
          ...(target.modelSelection ? { modelSelection: target.modelSelection } : {}),
        });
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
        ...(intentId ? { intentId } : {}),
        ...(intentName ? { intentName } : {}),
        ...(pr.headBranch ? { branch: pr.headBranch } : {}),
        startedAt: now,
        updatedAt: now,
        status,
      };
      await sessions.addJob(job);
      await saveSettings({ ...settings, lastPrUrl: pr.url });
      if (settings.openInAppAfterDispatch) void openThread(connections, env, threadId).catch(() => undefined);
      return { job, session: sessions.sessionFromJob(job) };
    },

    "project.create": async ({ envKey, pr, destinationPath, title }) => {
      const project = await catalog.createProjectFromRepo(
        envKey,
        { owner: pr.owner, name: pr.repo, host: pr.host },
        destinationPath,
        title,
      );
      return { project };
    },

    "session.reply": async ({ envKey, threadId, message, mode, requestId }) => {
      const { target, transport } = await catalog.resolve(envKey);
      const envArgs = target.toolEnvironmentId ? { environmentId: target.toolEnvironmentId } : {};
      let answered = false;
      if (requestId) {
        const job = await sessions.jobForThread(envKey, threadId);
        const pending =
          (job ? sessions.sessionFromJob(job).pending : undefined) ??
          (await catalog.pendingQuestions(envKey, threadId).catch(() => []));
        const question = pending?.find((q) => q.requestId === requestId);
        if (question) {
          try {
            await catalog.respondToQuestion(envKey, threadId, question, message);
            answered = true;
          } catch {
            answered = false;
          }
        }
      }
      if (!answered) {
        await transport.callTool("t3_thread_send", {
          ...envArgs,
          clientRequestId: crypto.randomUUID(),
          threadId,
          message,
          mode: mode ?? "auto",
        });
      }
      catalog.invalidateThreads(envKey);
      return { session: await sessionFor(envKey, threadId) };
    },

    "session.stop": async ({ envKey, threadId }) => {
      const { target, transport } = await catalog.resolve(envKey);
      const envArgs = target.toolEnvironmentId ? { environmentId: target.toolEnvironmentId } : {};
      await transport.callTool("t3_thread_interrupt", {
        ...envArgs,
        clientRequestId: crypto.randomUUID(),
        threadId,
        stop: true,
        reason: "Vom Nutzer in GitHub gestoppt.",
      });
      catalog.invalidateThreads(envKey);
      return { session: await sessionFor(envKey, threadId) };
    },

    "session.refresh": async ({ envKey, threadId }) => ({ session: await sessionFor(envKey, threadId) }),
    "session.dismiss": async ({ jobId }) => {
      await sessions.dismiss(jobId);
      return { ok: true };
    },
    "sessions.inbox": async () => ({ sessions: await sessions.inbox() }),

    "threads.search": async ({ envKey, query, projectId }) => ({
      threads: await catalog.searchThreads(envKey, query, projectId),
    }),

    "templates.list": async () => ({ templates: await allTemplates() }),
    "templates.save": async ({ template }) => {
      const custom = (await loadCustomTemplates()).filter((t) => t.id !== template.id);
      custom.push({ ...template, builtin: BUILTIN_TEMPLATES.some((t) => t.id === template.id) });
      await saveCustomTemplates(custom);
      return { templates: await allTemplates() };
    },
    "templates.delete": async ({ id }) => {
      await saveCustomTemplates((await loadCustomTemplates()).filter((t) => t.id !== id));
      return { templates: await allTemplates() };
    },
    "templates.import": async ({ templates }) => {
      const map = new Map((await loadCustomTemplates()).map((t) => [t.id, t]));
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

    "thread.open": async ({ envKey, threadId }) => {
      const { target } = await catalog.resolve(envKey);
      return { ok: true, opened: await openThread(connections, target, threadId) };
    },
    "shortcut.get": async () => {
      const commands = await chrome.commands.getAll();
      return { shortcut: commands.find((command) => command.name === "open-panel")?.shortcut ?? "" };
    },
    "shortcut.edit": async () => {
      // Every Chromium browser (Chrome, Dia, Arc, Edge, Brave) serves this page under chrome://.
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      return { ok: true };
    },
    "options.open": async ({ tab }) => {
      if (tab) {
        await chrome.tabs.create({ url: `${chrome.runtime.getURL("src/options/index.html")}#${tab}` });
      } else {
        await chrome.runtime.openOptionsPage();
      }
      return { ok: true };
    },
  };
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function installRouter(deps: RouterDeps): void {
  const handlers = createHandlers(deps);
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) return false;
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
