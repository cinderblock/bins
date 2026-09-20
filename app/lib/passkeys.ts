/**
 * Passkeys for admin, client side. See api/passkeys.ts for the ceremonies;
 * this is the browser half of each, plus the status the unlock UIs need to
 * decide whether to offer the button at all.
 */
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { apiJson } from "./api";
import { adoptIdentity } from "./auth";
import type { Identity } from "./db";

export type PasskeyRow = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type PasskeyStatus = { registered: number; adminUntil: number | null };

export async function passkeyStatus(): Promise<PasskeyStatus> {
  return apiJson<PasskeyStatus>("/api/passkey/status", { method: "POST" });
}

/** Can this browser do passkeys at all? (Every modern one; not all webviews.) */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function"
  );
}

/**
 * Register a passkey for the group on this device. Admin must be unlocked
 * (the password, or an earlier passkey) — that is what authorises minting a
 * new way in.
 */
export async function registerPasskey(
  adminPassword: string,
  label: string,
): Promise<PasskeyRow[]> {
  const { options } = await apiJson<{
    options: Parameters<typeof startRegistration>[0]["optionsJSON"];
  }>("/api/admin/passkeys/register/options", {
    method: "POST",
    body: JSON.stringify({ adminPassword }),
  });
  const response = await startRegistration({ optionsJSON: options });
  const result = await apiJson<{ passkeys: PasskeyRow[] }>(
    "/api/admin/passkeys/register/verify",
    {
      method: "POST",
      body: JSON.stringify({ adminPassword, label, response }),
    },
  );
  return result.passkeys;
}

/**
 * Sign in with a passkey. On a joined device the server marks it admin and
 * the caller records the unlock locally. On a device with no identity (a
 * browser reaching in from outside the network) the server mints one, with
 * the given name, and it is adopted here exactly like a join.
 */
export async function loginWithPasskey(anonymous?: {
  displayName: string;
}): Promise<{ adminUntil: number }> {
  const { session, options } = await apiJson<{
    session: string;
    options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
  }>("/api/passkey/login/options", { method: "POST" });
  const response = await startAuthentication({ optionsJSON: options });
  const result = await apiJson<{
    ok: true;
    adminUntil: number;
    identity?: Identity;
  }>("/api/passkey/login/verify", {
    method: "POST",
    body: JSON.stringify({
      session,
      response,
      ...(anonymous ? { displayName: anonymous.displayName } : {}),
    }),
  });
  if (result.identity) await adoptIdentity(result.identity, false);
  return result;
}

export async function listPasskeys(
  adminPassword: string,
): Promise<PasskeyRow[]> {
  const res = await apiJson<{ passkeys: PasskeyRow[] }>("/api/admin/passkeys", {
    method: "POST",
    body: JSON.stringify({ adminPassword }),
  });
  return res.passkeys;
}

export async function removePasskey(
  adminPassword: string,
  id: string,
): Promise<PasskeyRow[]> {
  const res = await apiJson<{ passkeys: PasskeyRow[] }>(
    "/api/admin/passkeys/remove",
    { method: "POST", body: JSON.stringify({ adminPassword, id }) },
  );
  return res.passkeys;
}

/** A sensible default name for the passkey being made on this device. */
export function defaultPasskeyLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
