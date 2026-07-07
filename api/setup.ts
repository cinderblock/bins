/**
 * First-boot setup: while the database has ZERO groups, one unauthenticated
 * call creates the group and mints the caller's device token — the operator
 * becomes the first member in the same step. Locked forever after (additional
 * groups: scripts/create-group.ts).
 */
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { mintDevice, normalizeAccessCode } from "./auth";
import { error, serializedTransaction, sha256Hex } from "./context";

const setupSchema = z.object({
  groupName: z.string().min(1).max(100),
  /** Null/empty → the landing derives "{name} Inventory Management System". */
  landingTitle: z.string().max(200).nullish(),
  landingSubtitle: z.string().max(200).nullish(),
  accessCode: z.string().min(4).max(200),
  adminPassword: z.string().min(4).max(200),
  displayName: z.string().min(1).max(100),
  deviceId: z.string().uuid(),
});

export async function handleSetup(req: Request): Promise<Response> {
  const parsed = setupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "invalid setup request");
  const p = parsed.data;

  // Serialized: two racing setup calls must not both create a group.
  return serializedTransaction(async () => {
    const existing = await db.query.group.findFirst();
    if (existing) return error(403, "already set up");

    const groupId = crypto.randomUUID();
    await db.insert(schema.group).values({
      id: groupId,
      name: p.groupName.trim(),
      accessCodeHash: sha256Hex(normalizeAccessCode(p.accessCode)),
      landingTitle: p.landingTitle?.trim() || null,
      landingSubtitle: p.landingSubtitle?.trim() || null,
      adminPasswordHash: sha256Hex(p.adminPassword),
    });
    return mintDevice(
      { id: groupId, name: p.groupName.trim() },
      p.displayName,
      p.deviceId,
    );
  });
}
