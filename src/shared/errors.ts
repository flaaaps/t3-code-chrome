export type ExtensionErrorCode =
  | "unreachable"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_response"
  | "tool_error"
  | "timeout"
  | "cancelled"
  | "invalid_input"
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

export function serializeError(error: unknown): SerializedError {
  if (error instanceof ExtensionError) return error.toJSON();
  if (error instanceof Error) {
    if (error.name === "AbortError") return { code: "cancelled", message: "Request was cancelled." };
    if (/Failed to fetch|NetworkError|ECONNREFUSED|Load failed/i.test(error.message)) {
      return { code: "unreachable", message: "T3 Code is not reachable. Is the desktop app running?" };
    }
    return { code: "unknown", message: error.message };
  }
  return { code: "unknown", message: String(error) };
}
