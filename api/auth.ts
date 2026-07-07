/**
 * Join + identity endpoints. No accounts: proving membership — the group
 * access code, or a valid (binId, code) pair off a sticker — with a display
 * name mints a device row and a long-lived opaque bearer token (returned
 * once, stored hashed). Revocation = delete the device row.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { normalizeSecretCode, secretCodeSchema } from "../shared/ops";
import { type Ctx, error, json, sha256Hex } from "./context";

const displayName = z.string().min(1).max(100);
const deviceId = z.string().uuid();

const joinSchema = z.object({
  accessCode: z.string().min(1).max(200),
  displayName,
  deviceId,
});

const joinByBinSchema = z.object({
  binId: z.number().int().positive(),
  code: secretCodeSchema,
  displayName,
  deviceId,
});

export function normalizeAccessCode(code: string): string {
  return code.trim().toLowerCase();
}

/** Mint the device row + bearer token — the shared tail of every join path. */
export async function mintDevice(
  group: { id: string; name: string },
  displayName: string,
  deviceId: string,
): Promise<Response> {
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

  return mintDevice(group, displayName, deviceId);
}

/**
 * Join by sticker: a valid (binId, code) pair seen once = proof of physical
 * access to the group's stuff. Works for ANY bin status — a fresh unclaimed
 * sticker is as good as a claimed one. Bare bin ids grant nothing.
 */
export async function handleJoinByBin(req: Request): Promise<Response> {
  const parsed = joinByBinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "invalid join request");
  const { binId, code, displayName, deviceId } = parsed.data;

  // Short IDs are globally unique across groups; the bin resolves the group.
  const bin = await db.query.bin.findFirst({
    where: eq(schema.bin.id, binId),
    columns: { groupId: true, secretCode: true },
  });
  if (
    !bin?.secretCode ||
    normalizeSecretCode(bin.secretCode) !== normalizeSecretCode(code)
  ) {
    // One error for both unknown-bin and wrong-code: don't leak which ids exist.
    return error(403, "unknown bin or code");
  }

  const group = await db.query.group.findFirst({
    where: eq(schema.group.id, bin.groupId),
  });
  if (!group) return error(403, "unknown bin or code");

  return mintDevice(group, displayName, deviceId);
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
