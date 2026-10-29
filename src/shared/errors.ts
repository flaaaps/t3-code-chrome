export type ExtensionErrorCode =
  | "unreachable"
  | "unauthenticated"
  | "unpaired"
  | "forbidden"
  | "not_found"
  | "invalid_response"
  | "tool_error"
  | "timeout"
  | "cancelled"
  | "invalid_input"
  | "no_connection"
  | "unknown";

export class ExtensionError extends Error {
  readonly code: ExtensionErrorCode;
  readonly details: unknown;

  constructor(code: ExtensionErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ExtensionError";
    this.code = code;
    this.details = details;
  }

  toJSON(): SerializedError {
    return { code: this.code, message: this.message };
  }
}

export interface SerializedError {
  code: ExtensionErrorCode;
  message: string;
}

/** Map the server's English messages to German user-facing text. */
export function translateServerMessage(message: string): string {
  const text = message.trim();
  const rules: Array<[RegExp, string]> = [
    [/unknown, expired, or already used/i, "Der Pairing-Code ist unbekannt, abgelaufen oder schon benutzt."],
    [/not a pairing code/i, "Das ist kein Pairing-Code."],
    [/insufficient scope|scope/i, "Der Pairing-Code erlaubt dieses Zugriffslevel nicht."],
    [
      /invalid_mcp_credential|MCP credential/i,
      "Die Verbindung zu T3 Code ist abgelaufen oder wurde widerrufen.",
    ],
    [
      /linked environments is off/i,
      "Verlinkte Environments sind in T3 Code ausgeschaltet (Settings → Labs).",
    ],
    [/session could not be issued/i, "T3 Code konnte keine Sitzung ausstellen."],
    [/not found/i, "Nicht gefunden."],
  ];
  for (const [pattern, german] of rules) if (pattern.test(text)) return german;
  return text;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof ExtensionError) return error.toJSON();
  if (error instanceof Error) {
    if (error.name === "AbortError") return { code: "cancelled", message: "Abgebrochen." };
    if (/Failed to fetch|NetworkError|ECONNREFUSED|Load failed/i.test(error.message)) {
      return { code: "unreachable", message: "T3 Code antwortet nicht. Läuft die Desktop-App?" };
    }
    return { code: "unknown", message: translateServerMessage(error.message) };
  }
  return { code: "unknown", message: String(error) };
}
