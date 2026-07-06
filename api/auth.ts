/**
 * Join + identity endpoints. No accounts: entering the group access code with
 * a display name mints a device row and a long-lived opaque bearer token
 * (returned once, stored hashed). Revocation = delete the device row.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { type Ctx, error, json, sha256Hex } from "./context";

const joinSchema = z.object({
  accessCode: z.string().min(1).max(200),
  displayName: z.string().min(1).max(100),
  deviceId: z.string().uuid(),
});

export function normalizeAccessCode(code: string): string {
  return code.trim().toLowerCase();
}

export async function handleJoin(req: Request): Promise<Response> {
  const parsed = joinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "invalid join request");
  const { accessCode, displayName, deviceId } = parsed.data;

  const group = await db.query.group.findFirst({
    where: eq(
      schema.group.accessCodeHash,
      sha256Hex(normalizeAccessCode(accessCode)),
    ),
  });
  if (!group) return error(403, "unknown access code");

  const existing = await db.query.device.findFirst({
    where: eq(schema.device.id, deviceId),
  });
  // A stale/duplicated deviceId must not let anyone adopt another device's
  // identity — the client just regenerates a uuid and retries.
  if (existing) return error(409, "device id already registered");

  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.insert(schema.device).values({
    id: deviceId,
    groupId: group.id,
    displayName,
    tokenHash: sha256Hex(token),
  });

  return json({
    token,
    deviceId,
    groupId: group.id,
    groupName: group.name,
    displayName,
  });
}

export async function handleMe(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method === "GET") {
    const group = await db.query.group.findFirst({
      where: eq(schema.group.id, ctx.groupId),
    });
    return json({
      deviceId: ctx.deviceId,
      displayName: ctx.displayName,
      group: { id: ctx.groupId, name: group?.name ?? "" },
    });
  }
  // PATCH — rename this device's author label.
  const parsed = z
    .object({ displayName: z.string().min(1).max(100) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "invalid rename");
  await db
    .update(schema.device)
    .set({ displayName: parsed.data.displayName })
    .where(eq(schema.device.id, ctx.deviceId));
  return json({ ok: true });
}

export async function handleDevices(ctx: Ctx): Promise<Response> {
  const rows = await db.query.device.findMany({
    where: eq(schema.device.groupId, ctx.groupId),
    columns: { id: true, displayName: true },
  });
  return json({ devices: rows });
}
