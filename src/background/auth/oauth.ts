import { ExtensionError, translateServerMessage } from "@shared/errors";
import type { ConnectionAuth, McpClientAccess } from "@shared/models";

export interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

export interface EnvironmentDescriptor {
  environmentId: string;
  label?: string;
  serverVersion?: string;
}

const CLIENT_NAME = "T3 Code for GitHub (Chrome)";

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const description =
        (parsed as { error_description?: string; message?: string } | undefined)?.error_description ??
        (parsed as { message?: string } | undefined)?.message ??
        `${response.status} ${response.statusText}`;
      throw new ExtensionError(
        response.status === 401 ? "unauthenticated" : "invalid_response",
        translateServerMessage(description),
        parsed,
      );
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    if (controller.signal.aborted)
      throw new ExtensionError("timeout", "T3 Code hat nicht rechtzeitig geantwortet.");
    throw new ExtensionError(
      "unreachable",
      "Unter dieser Adresse antwortet kein T3 Code. Läuft die Desktop-App?",
      error,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseOrigin(input: string): string {
  let text = input.trim();
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  const url = new URL(text);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

export async function probeEnvironment(origin: string): Promise<EnvironmentDescriptor> {
  return fetchJson<EnvironmentDescriptor>(
    `${origin}/.well-known/t3/environment`,
    { cache: "no-store" },
    5000,
  );
}

export async function discoverOAuth(origin: string): Promise<OAuthMetadata> {
  return fetchJson<OAuthMetadata>(`${origin}/.well-known/oauth-authorization-server`, { cache: "no-store" });
}

export function redirectUri(): string {
  return chrome.identity.getRedirectURL("t3");
}

export async function registerClient(metadata: OAuthMetadata): Promise<string> {
  if (!metadata.registration_endpoint) {
    throw new ExtensionError(
      "invalid_response",
      "Dieser T3-Code-Server unterstützt keine Client-Registrierung.",
    );
  }
  const registered = await fetchJson<{ client_id: string }>(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri()] }),
  });
  return registered.client_id;
}

export interface AuthorizationRequest {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  state: string;
  resource: string;
  scope: string;
}

export interface PreparedAuthorization {
  request: AuthorizationRequest;
  verifier: string;
  authorizeUrl: string;
}

export async function prepareAuthorization(
  origin: string,
  metadata: OAuthMetadata,
  clientId: string,
): Promise<PreparedAuthorization> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const request: AuthorizationRequest = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: base64Url(crypto.getRandomValues(new Uint8Array(16))),
    resource: `${origin}/mcp`,
    scope: (metadata.scopes_supported ?? ["orchestration:read", "orchestration:operate"]).join(" "),
  };
  const url = new URL(metadata.authorization_endpoint);
  for (const [key, value] of Object.entries(request)) url.searchParams.set(key, value);
  return { request, verifier, authorizeUrl: url.toString() };
}

/**
 * Approve the authorization directly with a pairing code (from `t3 auth pairing create` or
 * Settings → Connections in T3 Code). Returns the authorization code from the redirect.
 */
export async function approveWithPairingCode(
  origin: string,
  prepared: PreparedAuthorization,
  code: string,
  access: McpClientAccess,
): Promise<string> {
  const result = await fetchJson<{ redirectTo?: string }>(`${origin}/oauth/mcp/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      authorization: prepared.request,
      decision: { _tag: "pairing-code", access, code: code.trim() },
    }),
  }).catch((error: unknown) => {
    if (error instanceof ExtensionError && error.code === "invalid_response") {
      throw new ExtensionError("invalid_input", translateServerMessage(error.message));
    }
    throw error;
  });
  if (!result.redirectTo)
    throw new ExtensionError("invalid_response", "T3 Code hat keinen Autorisierungscode zurückgegeben.");
  return extractCode(result.redirectTo, prepared.request.state);
}

/** Run the interactive browser flow; the user approves on T3 Code's own page. */
export async function approveInBrowser(prepared: PreparedAuthorization): Promise<string> {
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: prepared.authorizeUrl,
    interactive: true,
  });
  if (!responseUrl) throw new ExtensionError("cancelled", "Das Anmeldefenster wurde geschlossen.");
  return extractCode(responseUrl, prepared.request.state);
}

function extractCode(redirectUrl: string, expectedState: string): string {
  const url = new URL(redirectUrl);
  const error = url.searchParams.get("error");
  if (error) {
    throw new ExtensionError(
      "forbidden",
      url.searchParams.get("error_description") ?? `Freigabe fehlgeschlagen: ${error}`,
    );
  }
  if (url.searchParams.get("state") !== expectedState) {
    throw new ExtensionError("invalid_response", "Die Antwort von T3 Code passt nicht zur Anfrage (state).");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new ExtensionError("invalid_response", "Die Antwort von T3 Code enthält keinen Code.");
  return code;
}

export async function exchangeCode(
  origin: string,
  metadata: OAuthMetadata,
  prepared: PreparedAuthorization,
  code: string,
  access: McpClientAccess,
): Promise<ConnectionAuth> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: prepared.request.redirect_uri,
    client_id: prepared.request.client_id,
    code_verifier: prepared.verifier,
    resource: `${origin}/mcp`,
  });
  const token = await fetchJson<{ access_token: string; expires_in?: number; scope?: string }>(
    metadata.token_endpoint,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
  );
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 30 * 24 * 3600;
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : [],
    access,
  };
}
