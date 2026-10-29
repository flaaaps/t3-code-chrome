import { ExtensionError } from "@shared/errors";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpTransportOptions {
  endpoint: string;
  accessToken: () => Promise<string | undefined>;
  clientName: string;
  clientVersion: string;
  onUnauthorized?: () => void;
  timeoutMs?: number;
}

/**
 * Minimal MCP Streamable HTTP client: one session per transport, JSON or SSE responses,
 * lazy initialize, re-initialize when the server forgets the session.
 */
export class McpTransport {
  private sessionId: string | undefined;
  private initializing: Promise<void> | undefined;
  private nextId = 1;
  private tools: McpToolDescriptor[] | undefined;
  private serverInfo: { name: string; version: string } | undefined;

  constructor(private readonly options: McpTransportOptions) {}

  get server(): { name: string; version: string } | undefined {
    return this.serverInfo;
  }

  reset(): void {
    this.sessionId = undefined;
    this.initializing = undefined;
    this.tools = undefined;
  }

  async listTools(force = false): Promise<McpToolDescriptor[]> {
    if (this.tools && !force) return this.tools;
    const result = (await this.request("tools/list", {})) as { tools?: McpToolDescriptor[] };
    this.tools = result.tools ?? [];
    return this.tools;
  }

  async hasTool(name: string): Promise<boolean> {
    const tools = await this.listTools();
    return tools.some((tool) => tool.name === name);
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = (await this.request("tools/call", { name, arguments: args })) as McpToolResult;
    if (result.isError) {
      const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "Tool call failed.";
      throw new ExtensionError("tool_error", text.trim() || `Tool ${name} failed.`, result);
    }
    if (result.structuredContent !== undefined) return result.structuredContent as T;
    const text = result.content?.find((c) => c.type === "text")?.text;
    if (text === undefined) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.sessionId) return;
    if (!this.initializing) {
      this.initializing = this.initialize().finally(() => {
        this.initializing = undefined;
      });
    }
    await this.initializing;
  }

  private async initialize(): Promise<void> {
    const { payload, headers } = await this.post(
      {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: this.options.clientName, version: this.options.clientVersion },
        },
      },
      { skipSession: true },
    );
    const response = payload as JsonRpcResponse;
    if (response.error) throw new ExtensionError("invalid_response", response.error.message, response.error);
    const result = response.result as { serverInfo?: { name: string; version: string } } | undefined;
    this.serverInfo = result?.serverInfo;
    this.sessionId = headers.get("mcp-session-id") ?? undefined;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, { notification: true });
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized();
    const id = this.nextId++;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const { payload } = await this.post({ jsonrpc: "2.0", id, method, params });
        const response = payload as JsonRpcResponse;
        if (response.error) {
          const code = response.error.code;
          if (code === -32001 || /session/i.test(response.error.message)) {
            if (attempt === 1) {
              this.reset();
              await this.ensureInitialized();
              continue;
            }
          }
          throw new ExtensionError("tool_error", response.error.message, response.error);
        }
        return response.result;
      } catch (error) {
        if (error instanceof ExtensionError && error.code === "not_found" && attempt === 1) {
          this.reset();
          await this.ensureInitialized();
          continue;
        }
        throw error;
      }
    }
  }

  private async post(
    body: Record<string, unknown>,
    options: { skipSession?: boolean; notification?: boolean } = {},
  ): Promise<{ payload: unknown; headers: Headers }> {
    const token = await this.options.accessToken();
    if (!token) throw new ExtensionError("unauthenticated", "Not connected to T3 Code.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    };
    if (!options.skipSession && this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000);
    let response: Response;
    try {
      response = await fetch(this.options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new ExtensionError("timeout", "T3 Code did not answer in time.");
      throw new ExtensionError("unreachable", "T3 Code is not reachable. Is the desktop app running?", error);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      this.options.onUnauthorized?.();
      throw new ExtensionError(
        "unauthenticated",
        "The T3 Code connection expired or was revoked. Reconnect in the options.",
      );
    }
    if (response.status === 403)
      throw new ExtensionError("forbidden", "This connection lacks permission for that action.");
    if (response.status === 404) throw new ExtensionError("not_found", "MCP session not found.");
    if (options.notification) {
      return { payload: undefined, headers: response.headers };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ExtensionError(
        "invalid_response",
        `T3 Code answered ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const payload = await readSseResponse(response, body.id as number | string | undefined);
      return { payload, headers: response.headers };
    }
    const text = await response.text();
    if (text.trim().length === 0) return { payload: undefined, headers: response.headers };
    try {
      return { payload: JSON.parse(text), headers: response.headers };
    } catch {
      throw new ExtensionError(
        "invalid_response",
        "T3 Code returned a response the extension could not parse.",
      );
    }
  }
}

/** Read an SSE stream until the JSON-RPC response for `id` arrives. */
async function readSseResponse(response: Response, id: number | string | undefined): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ExtensionError("invalid_response", "Empty response body.");
  const decoder = new TextDecoder();
  let buffer = "";
  let fallback: unknown;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
      const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const message = parsed as JsonRpcResponse;
      if (id !== undefined && message.id === id) {
        reader.cancel().catch(() => undefined);
        return message;
      }
      if (message.id !== undefined && message.id !== null) fallback = message;
    }
  }
  if (fallback !== undefined) return fallback;
  throw new ExtensionError("invalid_response", "The MCP stream ended without a response.");
}
