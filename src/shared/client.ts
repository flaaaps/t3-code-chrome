/**
 * Lightweight request helper for UI surfaces. Kept separate from `messages.ts` so the content
 * script does not bundle the zod schemas, which only the service worker needs for validation.
 */
import type { SerializedError } from "./errors";
import type { Envelope, RequestOf, RequestType, ResponseOf } from "./messages";

export type { ExtensionEvent } from "./messages";

export class RequestError extends Error {
  code: SerializedError["code"];
  constructor(error: SerializedError) {
    super(error.message);
    this.name = "RequestError";
    this.code = error.code;
  }
}

export async function sendRequest<T extends RequestType>(request: RequestOf<T>): Promise<ResponseOf<T>> {
  let envelope: Envelope<ResponseOf<T>> | undefined;
  try {
    envelope = (await chrome.runtime.sendMessage(request)) as Envelope<ResponseOf<T>> | undefined;
  } catch (error) {
    throw new RequestError({
      code: "unknown",
      message: `Der Hintergrunddienst der Extension antwortet nicht (${(error as Error).message}).`,
    });
  }
  if (!envelope) {
    throw new RequestError({
      code: "unknown",
      message: "Keine Antwort vom Hintergrunddienst der Extension.",
    });
  }
  if (!envelope.ok) throw new RequestError(envelope.error);
  return envelope.data;
}

export function errorCode(error: unknown): SerializedError["code"] | undefined {
  return error instanceof RequestError ? error.code : undefined;
}

/** Keep the service worker awake and ask it to poll sessions quickly while a surface is open. */
export function openLivePort(name: "panel" | "popup"): chrome.runtime.Port | undefined {
  try {
    return chrome.runtime.connect({ name: `live:${name}` });
  } catch {
    return undefined;
  }
}
