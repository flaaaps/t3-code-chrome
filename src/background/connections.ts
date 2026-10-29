import { ExtensionError } from "@shared/errors";
import {
  type ConnectionAuth,
  type ConnectionHealth,
  DEFAULT_LOCAL_ORIGIN,
  type LinkState,
  type McpClientAccess,
  type ServerConnection,
} from "@shared/models";
import {
  approveInBrowser,
  approveWithPairingCode,
  discoverOAuth,
  exchangeCode,
  normaliseOrigin,
  prepareAuthorization,
  probeEnvironment,
  registerClient,
} from "./auth/oauth";
import { McpTransport } from "./mcp/transport";
import { clearAuth, loadAuth, loadConnections, saveAuth, saveConnections } from "./storage";

const EXTENSION_VERSION = chrome.runtime.getManifest().version;

/** Manages configured T3 servers, their tokens and one MCP transport per server. */
export class ConnectionManager {
  private transports = new Map<string, McpTransport>();
  private health = new Map<string, ConnectionHealth>();
  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  async list(): Promise<ServerConnection[]> {
    return loadConnections();
  }

  async get(id: string): Promise<ServerConnection> {
    const connection = (await loadConnections()).find((c) => c.id === id);
    if (!connection) throw new ExtensionError("not_found", "Unbekannte T3-Code-Verbindung.");
    return connection;
  }

  healthOf(id: string): ConnectionHealth {
    return this.health.get(id) ?? "unknown";
  }

  /** Overall link state: no connections, none paired, all offline, or at least one ready. */
  async linkState(): Promise<LinkState> {
    const connections = await loadConnections();
    if (connections.length === 0) return "none";
    const states = connections.map((c) => this.healthOf(c.id));
    if (states.includes("connected")) return "ready";
    if (states.includes("unauthenticated")) return "unpaired";
    return "offline";
  }

  /** Add the default local server when it answers and is not configured yet. */
  async autoDetectLocal(): Promise<ServerConnection | undefined> {
    const existing = (await loadConnections()).find((c) => c.origin === DEFAULT_LOCAL_ORIGIN);
    if (existing) return existing;
    try {
      return await this.add(DEFAULT_LOCAL_ORIGIN);
    } catch {
      return undefined;
    }
  }

  async healthMap(): Promise<Record<string, ConnectionHealth>> {
    const result: Record<string, ConnectionHealth> = {};
    for (const connection of await loadConnections()) result[connection.id] = this.healthOf(connection.id);
    return result;
  }

  async add(originInput: string, label?: string): Promise<ServerConnection> {
    const origin = normaliseOrigin(originInput);
    const existing = (await loadConnections()).find((c) => c.origin === origin);
    if (existing) return existing;
    const descriptor = await probeEnvironment(origin);
    const connection: ServerConnection = {
      id: crypto.randomUUID(),
      origin,
      label: label?.trim() || descriptor.label || origin,
      environmentId: descriptor.environmentId,
      ...(descriptor.serverVersion ? { serverVersion: descriptor.serverVersion } : {}),
      createdAt: Date.now(),
    };
    await saveConnections([...(await loadConnections()), connection]);
    this.health.set(connection.id, "unauthenticated");
    this.emit();
    return connection;
  }

  async remove(id: string): Promise<void> {
    await clearAuth(id);
    await saveConnections((await loadConnections()).filter((c) => c.id !== id));
    this.transports.delete(id);
    this.health.delete(id);
    this.emit();
  }

  async disconnect(id: string): Promise<void> {
    await clearAuth(id);
    this.transports.get(id)?.reset();
    this.health.set(id, "unauthenticated");
    this.emit();
  }

  private async update(id: string, patch: Partial<ServerConnection>): Promise<ServerConnection> {
    const connections = await loadConnections();
    const index = connections.findIndex((c) => c.id === id);
    const current = connections[index];
    if (index === -1 || !current) throw new ExtensionError("not_found", "Unbekannte T3-Code-Verbindung.");
    const next: ServerConnection = { ...current, ...patch };
    connections[index] = next;
    await saveConnections(connections);
    return next;
  }

  /** Check reachability and token validity. */
  async probe(id: string): Promise<{ health: ConnectionHealth; connection: ServerConnection }> {
    let connection = await this.get(id);
    try {
      const descriptor = await probeEnvironment(connection.origin);
      if (
        descriptor.environmentId !== connection.environmentId ||
        descriptor.serverVersion !== connection.serverVersion
      ) {
        connection = await this.update(id, {
          environmentId: descriptor.environmentId,
          ...(descriptor.serverVersion ? { serverVersion: descriptor.serverVersion } : {}),
        });
      }
    } catch {
      this.health.set(id, "unreachable");
      this.emit();
      return { health: "unreachable", connection };
    }
    const auth = await loadAuth(id);
    if (!auth || auth.expiresAt <= Date.now()) {
      this.health.set(id, "unauthenticated");
      this.emit();
      return { health: "unauthenticated", connection };
    }
    try {
      await (await this.connectedTransport(id)).listTools(true);
      this.health.set(id, "connected");
    } catch (error) {
      console.warn(
        "[t3] MCP probe failed",
        error instanceof Error ? `${error.name}: ${error.message}` : error,
        (error as { details?: unknown })?.details,
      );
      this.health.set(
        id,
        error instanceof ExtensionError && error.code === "unauthenticated"
          ? "unauthenticated"
          : "unreachable",
      );
    }
    this.emit();
    return { health: this.healthOf(id), connection };
  }

  async pairWithCode(id: string, code: string, access: McpClientAccess): Promise<ServerConnection> {
    const connection = await this.get(id);
    const metadata = await discoverOAuth(connection.origin);
    const clientId = await this.clientId(connection, metadata);
    const prepared = await prepareAuthorization(connection.origin, metadata, clientId);
    const authCode = await approveWithPairingCode(connection.origin, prepared, code, access);
    const auth = await exchangeCode(connection.origin, metadata, prepared, authCode, access);
    return this.finishPairing(id, auth);
  }

  async pairInBrowser(id: string): Promise<ServerConnection> {
    const connection = await this.get(id);
    const metadata = await discoverOAuth(connection.origin);
    const clientId = await this.clientId(connection, metadata);
    const prepared = await prepareAuthorization(connection.origin, metadata, clientId);
    const authCode = await approveInBrowser(prepared);
    // The access level is chosen on T3's approval page; "auto" is a reasonable label until probed.
    const auth = await exchangeCode(connection.origin, metadata, prepared, authCode, "auto");
    return this.finishPairing(id, auth);
  }

  private async clientId(connection: ServerConnection, metadata: Awaited<ReturnType<typeof discoverOAuth>>) {
    if (connection.clientId) return connection.clientId;
    const clientId = await registerClient(metadata);
    await this.update(connection.id, { clientId });
    return clientId;
  }

  private async finishPairing(id: string, auth: ConnectionAuth): Promise<ServerConnection> {
    await saveAuth(id, auth);
    this.transports.get(id)?.reset();
    const probed = await this.probe(id);
    if (probed.health !== "connected") {
      throw new ExtensionError(
        "unreachable",
        "Gekoppelt, aber der MCP-Endpunkt antwortet nicht. Läuft T3 Code?",
      );
    }
    return probed.connection;
  }

  transport(id: string): McpTransport {
    let transport = this.transports.get(id);
    if (!transport) {
      transport = new McpTransport({
        endpoint: "",
        accessToken: async () => {
          const auth = await loadAuth(id);
          if (!auth || auth.expiresAt <= Date.now()) return undefined;
          return auth.accessToken;
        },
        clientName: "t3-code-chrome",
        clientVersion: EXTENSION_VERSION,
        onUnauthorized: () => {
          this.health.set(id, "unauthenticated");
          this.emit();
        },
      });
      this.transports.set(id, transport);
    }
    return transport;
  }

  /** Transport bound to the connection's current origin. */
  async connectedTransport(id: string): Promise<McpTransport> {
    const connection = await this.get(id);
    const transport = this.transport(id);
    const endpoint = `${connection.origin}/mcp`;
    if ((transport as unknown as { options: { endpoint: string } }).options.endpoint !== endpoint) {
      (transport as unknown as { options: { endpoint: string } }).options.endpoint = endpoint;
      transport.reset();
    }
    return transport;
  }
}
