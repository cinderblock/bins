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
 * Unlock admin on this device with a passkey. On success the server marks
 * this device admin; the caller records the unlock locally.
 */
export async function loginWithPasskey(): Promise<{ adminUntil: number }> {
  const { options } = await apiJson<{
    options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
  }>("/api/passkey/login/options", { method: "POST" });
  const response = await startAuthentication({ optionsJSON: options });
  return apiJson<{ ok: true; adminUntil: number }>(
    "/api/passkey/login/verify",
    { method: "POST", body: JSON.stringify({ response }) },
  );
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
