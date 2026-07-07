/**
 * Admin unlock, remembered per device. The group admin password gates every
 * /api/admin/* request (the server re-verifies it each time — there are no
 * admin sessions). We cache the verified password in the Dexie replica, the
 * same device-local trust boundary that already holds the member token, so an
 * admin doesn't re-type it on every visit. "Locking" is a plain meta delete.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { apiJson } from "./api";
import { ADMIN_PASSWORD_KEY, db, getMeta, setMeta } from "./db";

export async function rememberAdmin(password: string): Promise<void> {
  await setMeta(ADMIN_PASSWORD_KEY, password);
}

export async function forgetAdmin(): Promise<void> {
  await db.meta.delete(ADMIN_PASSWORD_KEY);
}

/** Check a candidate password against the server (also loads group config). */
export async function verifyAdmin<T = { config: unknown }>(
  password: string,
): Promise<T> {
  return apiJson<T>("/api/admin/verify", {
    method: "POST",
    body: JSON.stringify({ adminPassword: password }),
  });
}

/**
 * Reactive remembered password: `undefined` while loading, `null` when locked,
 * the password string when this device has an unlocked admin.
 */
export function useAdminPassword(): string | null | undefined {
  return useLiveQuery(
    async () => (await getMeta<string>(ADMIN_PASSWORD_KEY)) ?? null,
    [],
    undefined,
  );
}
