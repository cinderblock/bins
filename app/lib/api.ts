/**
 * Thin authenticated fetch wrapper. The bearer token lives in the Dexie meta
 * table (the replica IS the auth boundary on this device) and is cached in
 * module state after the first read.
 */
import { getIdentity } from "./db";

/**
 * The commit this bundle was built from, stamped in by Vite at build time
 * ("dev" outside CI). Sent on every API call — see apiFetch.
 */
export const BUILD_SHA: string =
  typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";

let cachedToken: string | null | undefined;

export function setCachedToken(token: string | null) {
  cachedToken = token;
}

async function token(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = (await getIdentity())?.token ?? null;
  return cachedToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const bearer = await token();
  const headers = new Headers(init?.headers);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  // Which build this device is actually RUNNING, which is a different question
  // from which build the server is serving. A fleet of phones can sit on old
  // code invisibly — that is precisely what went unnoticed for weeks — so the
  // server records it per device and /admin shows who is behind.
  headers.set("X-Bins-Build", BUILD_SHA);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
  return (await res.json()) as T;
}
