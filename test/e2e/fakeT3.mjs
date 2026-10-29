/**
 * A tiny stand-in for the T3 Code server: discovery, OAuth pairing and the MCP tools the extension
 * uses, backed by fixed demo data. Used to take README screenshots without touching a real T3
 * install (no private project names, no agent runs).
 */
import http from "node:http";

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

export const DEMO_PR = {
  host: "github.com",
  owner: "flaaaps",
  repo: "pondus",
  number: 5,
  url: "https://github.com/flaaaps/pondus/pull/5",
  head: "fix/no-active-workout-screen",
};

const ENVIRONMENT_ID = "demo-env-0001";
const prLink = {
  host: "github.com",
  repository: "flaaaps/pondus",
  number: 5,
  url: DEMO_PR.url,
  state: "open",
};

const projects = [
  {
    id: "p-pondus",
    title: "Pondus",
    workspaceRoot: "/Users/demo/code/pondus",
    repositoryIdentity: {
      canonicalKey: "github.com/flaaaps/pondus",
      displayName: "flaaaps/pondus",
      provider: "github",
      owner: "flaaaps",
      name: "pondus",
    },
    defaultModelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
    updatedAt: minutesAgo(5),
    deletedAt: null,
  },
  {
    id: "p-web",
    title: "acme-web",
    workspaceRoot: "/Users/demo/code/acme-web",
    repositoryIdentity: { canonicalKey: "github.com/acme/web", displayName: "acme/web" },
    defaultModelSelection: null,
    updatedAt: minutesAgo(600),
    deletedAt: null,
  },
  {
    id: "p-api",
    title: "acme-api",
    workspaceRoot: "/Users/demo/code/acme-api",
    repositoryIdentity: { canonicalKey: "github.com/acme/api", displayName: "acme/api" },
    defaultModelSelection: null,
    updatedAt: minutesAgo(2000),
    deletedAt: null,
  },
];

const thread = (id, projectId, title, status, model, updatedMinutes, linked) => ({
  threadId: id,
  projectId,
  title,
  link: `t3-thread://v2/${ENVIRONMENT_ID}/${id}`,
  status,
  providerInstanceId: "claudeAgent",
  model,
  runtimeMode: "full-access",
  pullRequests: linked ? [prLink] : [],
  settled: !["running", "waiting", "queued", "starting"].includes(status),
  parentThreadId: null,
  createdAt: minutesAgo(updatedMinutes + 30),
  updatedAt: minutesAgo(updatedMinutes),
});

export const threads = [
  thread(
    "t-review",
    "p-pondus",
    "Review: leerer Workout-Screen nach Beenden",
    "waiting",
    "claude-opus-5-5",
    2,
    true,
  ),
  thread("t-ci", "p-pondus", "CI fixen: live-activity.test.ts", "running", "claude-sonnet-5-5", 1, true),
  thread("t-summary", "p-pondus", "PR zusammenfassen", "completed", "claude-opus-5-5", 55, true),
  thread("t-spike", "p-pondus", "Live Activities Spike", "completed", "claude-opus-5-5", 60 * 26, false),
  thread(
    "t-bell",
    "p-pondus",
    "Glocke am Pausenende über Kopfhörer",
    "completed",
    "claude-sonnet-5-5",
    60 * 50,
    false,
  ),
  thread("t-web", "p-web", "Dark Mode für das Dashboard", "completed", "claude-opus-5-5", 60 * 8, false),
  thread("t-api", "p-api", "Rate-Limit für Exporte", "running", "claude-opus-5-5", 12, false),
];

const reads = {
  "t-review": {
    user: "Führe ein gründliches Code-Review für den Pull Request durch …",
    assistant:
      "Ich habe 3 Findings (1× hoch, 2× mittel). Das wichtigste: `flush()` läuft erneut, während die Outbox noch synchronisiert, und kann „Beenden“ doppelt auslösen. Soll ich die Findings als Inline-Kommentare posten oder zuerst die fehlenden Tests für den Offline-Fall ergänzen?",
    question: {
      id: "next-step",
      question: "Findings als Inline-Kommentare posten oder zuerst Tests für den Offline-Fall ergänzen?",
      options: ["Inline posten", "Erst Tests ergänzen"],
    },
  },
  "t-ci": {
    user: "Die Checks des Pull Requests schlagen fehl …",
    assistant:
      "Reproduziere den Jest-Fehler in `live-activity.test.ts` lokal: der Timer-Mock greift seit dem Upgrade auf Jest 30 nicht mehr. Ich stelle auf `jest.useFakeTimers({ now })` um und lasse die Suite erneut laufen.",
  },
  "t-summary": {
    user: "Fasse den Pull Request zusammen …",
    assistant:
      "Der PR behebt drei Navigationsfälle, in denen nach dem Beenden eines Workouts ein leerer Screen erschien. Risiko gering: die Änderungen beschränken sich auf den Router und den Outbox-Flush. Offene Frage: Soll „Verwerfen“ die Live Activity sofort beenden?",
  },
};

const capabilities = {
  runtimeMode: "full-access",
  interactionMode: "default",
  providers: [
    {
      providerInstanceId: "claudeAgent",
      displayName: "Claude",
      models: [
        { id: "claude-opus-5-5", label: "Claude Opus 5.5", options: [] },
        { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", options: [] },
        { id: "claude-fable-5-1", label: "Claude Fable 5.1", options: [] },
      ],
    },
    {
      providerInstanceId: "codex",
      displayName: "Codex",
      models: [{ id: "gpt-6-luna", label: "GPT-6 Luna", options: [] }],
    },
  ],
};

const TOOLS = [
  "t3_project_list",
  "t3_thread_list",
  "t3_thread_search",
  "t3_thread_read",
  "t3_thread_wait",
  "t3_thread_send",
  "t3_thread_launch",
  "t3_thread_interrupt",
  "t3_pending_request",
  "orchestrator_capabilities",
].map((name) => ({ name, inputSchema: { type: "object" } }));

function callTool(name, args) {
  switch (name) {
    case "t3_project_list":
      return { projects, nextCursor: null };
    case "t3_thread_list":
      return { threads, nextCursor: null, total: threads.length };
    case "t3_thread_search": {
      const query = String(args.query ?? "").toLowerCase();
      return { threads: threads.filter((t) => t.title.toLowerCase().includes(query)) };
    }
    case "t3_thread_read": {
      const t = threads.find((entry) => entry.threadId === args.threadId);
      const r = reads[args.threadId];
      if (!t) return { items: [] };
      return {
        thread: { status: t.status, updatedAt: t.updatedAt, title: t.title, model: t.model },
        items: r
          ? [
              { role: "user", text: r.user, createdAt: t.createdAt },
              { role: "assistant", text: r.assistant, createdAt: t.updatedAt },
            ]
          : [],
        runs: [{ runId: `run-${t.threadId}` }],
      };
    }
    case "t3_pending_request": {
      const question = reads[args.threadId]?.question;
      if (args.action === "list") return { requests: question ? [{ requestId: `q-${args.threadId}` }] : [] };
      if (args.action === "read") return { request: { questions: question ? [question] : [] } };
      return { ok: true };
    }
    case "t3_thread_wait":
      return { status: "timeout" };
    case "t3_thread_send":
    case "t3_thread_interrupt":
      return { status: "queued" };
    case "t3_thread_launch":
      return { threadId: "t-new", link: `t3-thread://v2/${ENVIRONMENT_ID}/t-new`, status: "queued" };
    case "orchestrator_capabilities":
      return capabilities;
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
  });
}

export function startFakeT3(port) {
  const origin = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin);
    const json = (status, body, headers = {}) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        ...headers,
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      });
      res.end();
      return;
    }
    const body = await readBody(req);
    switch (url.pathname) {
      case "/.well-known/t3/environment":
        return json(200, { environmentId: ENVIRONMENT_ID, label: "MacBook Pro", serverVersion: "0.1.4" });
      case "/.well-known/oauth-authorization-server":
        return json(200, {
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/mcp/authorize`,
          token_endpoint: `${origin}/oauth/mcp/token`,
          registration_endpoint: `${origin}/oauth/mcp/register`,
          scopes_supported: ["orchestration:read", "orchestration:operate"],
        });
      case "/oauth/mcp/register":
        return json(201, { client_id: "demo-client", redirect_uris: JSON.parse(body).redirect_uris });
      case "/oauth/mcp/decision": {
        const { authorization } = JSON.parse(body);
        return json(200, {
          redirectTo: `${authorization.redirect_uri}?code=demo-code&state=${authorization.state}`,
        });
      }
      case "/oauth/mcp/token":
        return json(200, {
          access_token: "demo-token",
          token_type: "Bearer",
          expires_in: 2592000,
          scope: "orchestration:read orchestration:operate",
        });
      case "/mcp": {
        const message = JSON.parse(body || "{}");
        if (message.id === undefined) {
          res.writeHead(202);
          res.end();
          return;
        }
        if (message.method === "initialize") {
          return json(
            200,
            {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "T3 Code", version: "0.1.4" },
              },
            },
            { "mcp-session-id": "demo-session" },
          );
        }
        if (message.method === "tools/list")
          return json(200, { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
        if (message.method === "tools/call") {
          try {
            const result = callTool(message.params.name, message.params.arguments ?? {});
            return json(200, {
              jsonrpc: "2.0",
              id: message.id,
              result: { content: [{ type: "text", text: JSON.stringify(result) }] },
            });
          } catch (error) {
            return json(200, {
              jsonrpc: "2.0",
              id: message.id,
              result: { isError: true, content: [{ type: "text", text: String(error) }] },
            });
          }
        }
        return json(200, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "method not found" },
        });
      }
      default:
        return json(404, { error: "not_found" });
    }
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ origin, close: () => server.close() })),
  );
}
