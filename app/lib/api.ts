/**
 * Thin authenticated fetch wrapper. The bearer token lives in the Dexie meta
 * table (the replica IS the auth boundary on this device) and is cached in
 * module state after the first read.
 */
import { getIdentity } from "./db";

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
