/**
 * Lightweight request helper for UI surfaces. Kept separate from `messages.ts` so the content
 * script does not bundle the zod schemas, which only the service worker needs for validation.
 */
import type { SerializedError } from "./errors";
import type { Envelope, RequestOf, RequestType, ResponseOf } from "./messages";

export type { ExtensionEvent, ThreadMessagePreview } from "./messages";

export async function sendRequest<T extends RequestType>(request: RequestOf<T>): Promise<ResponseOf<T>> {
  const envelope = (await chrome.runtime.sendMessage(request)) as Envelope<ResponseOf<T>> | undefined;
  if (!envelope) {
    throw new Error("Keine Antwort vom Hintergrunddienst der Extension.");
  }
  if (!envelope.ok) {
    const error = new Error(envelope.error.message) as Error & { code?: SerializedError["code"] };
    error.code = envelope.error.code;
    throw error;
  }
  return envelope.data;
}
