/**
 * Device re-authentication. A 401 during sync means the server no longer
 * honors this device's token (device row deleted/revoked). The local replica
 * and outboxes stay intact the whole time — signing back in just mints a
 * fresh token so the queued work can flow again.
 */
import { setCachedToken } from "./api";
import {
  AUTH_DEAD_KEY,
  IDENTITY_KEY,
  type Identity,
  getIdentity,
  setMeta,
} from "./db";
import { syncNow } from "./sync";

export async function signBackIn(accessCode: string): Promise<void> {
  const identity = await getIdentity();
  if (!identity) throw new Error("not joined on this device");

  // Prefer the old deviceId — if the server deleted the row, re-registering
  // it keeps authorship labels continuous. 409 = the id is still registered
  // (we must not adopt a live device), so retry with a fresh one.
  let response: Response | null = null;
  for (const deviceId of [identity.deviceId, crypto.randomUUID()]) {
    response = await fetch("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessCode,
        displayName: identity.displayName,
        deviceId,
      }),
    });
    if (response.status !== 409) break;
  }
  if (!response?.ok) {
    const body = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "could not sign back in");
  }

  const fresh = (await response.json()) as Identity;
  // The replica and pending ops belong to the ORIGINAL group. A valid code
  // for a different group must not adopt them — that would push this group's
  // queued ops into another tenant.
  if (fresh.groupId !== identity.groupId) {
    throw new Error("that access code belongs to a different group");
  }

  await setMeta(IDENTITY_KEY, fresh);
  setCachedToken(fresh.token);
  await setMeta(AUTH_DEAD_KEY, false);
  void syncNow();
}
