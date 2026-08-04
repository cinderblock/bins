/**
 * Web-push notifications for admins.
 *
 * The app has no admin *identity* — only a shared group password — so
 * "notify the admins" has to mean "notify the devices that proved they know
 * it and asked to be told". Subscribing therefore rides the same
 * `requireAdmin` gate as the rest of /api/admin, and unsubscribing needs only
 * the device's own token (removing your own subscription can't hurt anyone).
 *
 * Delivery is FIRE AND FORGET. A push service being slow, down, or hostile
 * must never make an offline phone's sync fail — the notification is a
 * courtesy, the op log is the product. Every send is caught; a subscription
 * the push service declares dead (404/410) is deleted, which is the only way
 * these rows are ever cleaned up.
 */
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import webpush from "web-push";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { vapidKeys } from "./config";
import { type Ctx, error, json } from "./context";

export const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

export type PushPayload = {
  title: string;
  body: string;
  /** Where clicking the notification should land (same-origin path). */
  url: string;
  /** Collapse key — a second suggestion replaces the first rather than piling up. */
  tag: string;
};

/** Configured? Callers use this to 404 the endpoints rather than half-work. */
export function pushConfigured(): boolean {
  return vapidKeys() !== null;
}

/** What a push service is handed: one subscription, one encrypted payload. */
export type PushTransport = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<void>;

const realTransport: PushTransport = async (subscription, payload) => {
  await webpush.sendNotification(subscription, payload);
};

/**
 * Seam for tests, and only for tests.
 *
 * `web-push` always talks HTTPS, so a local stand-in server can't receive a
 * real delivery — and the parts worth testing here are ours anyway (who gets
 * notified, what the payload says, which failures retire a subscription), not
 * the library's RFC 8291 encryption. Production never calls this.
 */
let transport: PushTransport = realTransport;
export function setPushTransport(next: PushTransport | null): void {
  transport = next ?? realTransport;
}

/**
 * Store (or refresh) this device's subscription. Keyed by endpoint so a
 * re-subscribe replaces rather than duplicates — browsers hand back the same
 * endpoint until permission is revoked, and a device that re-unlocks admin
 * shouldn't accumulate rows.
 */
export async function handleSubscribe(ctx: Ctx, body: unknown) {
  if (!pushConfigured()) return error(404, "push is not configured here");
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) return error(400, "invalid subscription");
  const { endpoint, keys } = parsed.data;
  const existing = await db.query.pushSubscription.findFirst({
    where: eq(schema.pushSubscription.endpoint, endpoint),
  });
  if (existing) {
    await db
      .update(schema.pushSubscription)
      .set({
        groupId: ctx.groupId,
        deviceId: ctx.deviceId,
        p256dh: keys.p256dh,
        auth: keys.auth,
      })
      .where(eq(schema.pushSubscription.id, existing.id));
  } else {
    await db.insert(schema.pushSubscription).values({
      id: uuidv7(),
      groupId: ctx.groupId,
      deviceId: ctx.deviceId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
  }
  return json({ ok: true });
}

/**
 * Drop this device's subscriptions. Scoped to the caller's own deviceId, which
 * is why it needs no admin password: you can only ever silence yourself.
 */
export async function handleUnsubscribe(ctx: Ctx) {
  await db
    .delete(schema.pushSubscription)
    .where(
      and(
        eq(schema.pushSubscription.deviceId, ctx.deviceId),
        eq(schema.pushSubscription.groupId, ctx.groupId),
      ),
    );
  return json({ ok: true });
}

/** Whether THIS device currently has a subscription stored server-side. */
export async function handlePushStatus(ctx: Ctx) {
  const row = await db.query.pushSubscription.findFirst({
    where: and(
      eq(schema.pushSubscription.deviceId, ctx.deviceId),
      eq(schema.pushSubscription.groupId, ctx.groupId),
    ),
    columns: { id: true },
  });
  return json({ configured: pushConfigured(), subscribed: row !== undefined });
}

/**
 * Deliver to every subscribed admin device in a group, except the one that
 * caused the event (nobody needs telling about their own suggestion).
 *
 * Never throws and never rejects — callers `void` this.
 */
export async function notifyGroupAdmins(
  groupId: string,
  exceptDeviceId: string | null,
  payload: PushPayload,
): Promise<void> {
  const keys = vapidKeys();
  if (!keys) return;
  try {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    const rows = await db.query.pushSubscription.findMany({
      where: eq(schema.pushSubscription.groupId, groupId),
    });
    const targets = rows.filter((r) => r.deviceId !== exceptDeviceId);
    await Promise.all(
      targets.map(async (row) => {
        try {
          await transport(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth },
            },
            JSON.stringify(payload),
          );
          await db
            .update(schema.pushSubscription)
            .set({ lastOkAt: new Date() })
            .where(eq(schema.pushSubscription.id, row.id));
        } catch (err) {
          // 404/410 is the push service saying this endpoint is gone for good
          // (permission revoked, app uninstalled, keypair rotated). Anything
          // else — a timeout, a 5xx — is transient and the row stays.
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await db
              .delete(schema.pushSubscription)
              .where(eq(schema.pushSubscription.id, row.id));
          } else {
            console.warn(`push delivery failed (${status ?? "no status"})`);
          }
        }
      }),
    );
  } catch (err) {
    // Bad keypair, database hiccup — a notification is never worth an error
    // reaching the caller, which is mid-sync.
    console.warn("push notification skipped:", err);
  }
}
