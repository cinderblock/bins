/**
 * Web-push subscription, client half.
 *
 * Only offered to a device that has unlocked admin, because the only thing
 * bins pushes is "someone suggested an edit" and only an admin can act on it.
 * The server enforces the same rule: subscribing goes through /api/admin (the
 * password), unsubscribing needs only this device's own token.
 *
 * iOS note: `PushManager` exists in Safari 16.4+ but ONLY inside an installed
 * (standalone) PWA. Checking for the API is therefore not enough — a normal
 * iOS tab will offer the button and then fail at subscribe() — so
 * `pushAvailability` reports that case separately and the UI says "add to
 * home screen first" instead of showing a button that can't work.
 */
import { apiJson } from "./api";

export type PushAvailability =
  | { kind: "ready" }
  | { kind: "unsupported" }
  | { kind: "needs-install" }
  | { kind: "not-configured" };

/** Is this an installed PWA (rather than a browser tab)? */
function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag; still the only reliable signal there.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function pushAvailability(publicKey: string | null): PushAvailability {
  if (!publicKey) return { kind: "not-configured" };
  if (typeof window === "undefined") return { kind: "unsupported" };
  if (!("serviceWorker" in navigator) || !("Notification" in window))
    return { kind: "unsupported" };
  if (!("PushManager" in window)) {
    // iOS exposes PushManager only in standalone mode; on a desktop browser
    // that lacks it entirely, installing won't help either — but "install the
    // app" is the actionable half of the message and harmless if it's not.
    return standalone() ? { kind: "unsupported" } : { kind: "needs-install" };
  }
  return { kind: "ready" };
}

/**
 * VAPID keys travel as base64url; `applicationServerKey` wants bytes.
 * Typed as ArrayBuffer rather than Uint8Array because lib.dom's BufferSource
 * excludes views over a possibly-shared buffer.
 */
function decodeKey(base64Url: string): ArrayBuffer {
  const padded = base64Url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Ask for permission, subscribe with the push service, and register the
 * result server-side. Returns false when the user declines — a denial is a
 * legitimate answer, not an error to throw at them.
 */
export async function subscribeToPush(
  adminPassword: string,
  publicKey: string,
): Promise<boolean> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  // Reuse an existing subscription: calling subscribe() again with the same
  // key returns the same endpoint, but an OLD subscription made with a
  // different key would throw instead — drop it first.
  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const subscription = await registration.pushManager.subscribe({
    // Required by every browser: a push must always show something.
    userVisibleOnly: true,
    applicationServerKey: decodeKey(publicKey),
  });
  await apiJson("/api/admin/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      adminPassword,
      subscription: subscription.toJSON(),
    }),
  });
  return true;
}

/** Stop notifications on this device, both locally and server-side. */
export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  // Server-side removal is by deviceId, so it works even if the browser
  // already forgot the subscription (permission revoked in settings).
  await apiJson("/api/push/unsubscribe", { method: "POST" });
}

/** Does the server currently hold a subscription for this device? */
export async function pushSubscribed(): Promise<boolean> {
  try {
    const body = await apiJson<{ subscribed: boolean }>("/api/push/status");
    return body.subscribed;
  } catch {
    return false;
  }
}
