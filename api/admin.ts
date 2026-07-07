/**
 * Admin surface: group config (name, landing branding, code/password
 * rotation), sticker import for pre-existing printed labels, and device
 * management. Gated by the member's device token (which identifies the
 * group) PLUS the group's admin password on EVERY request — stateless, no
 * admin sessions to steal or expire.
 */
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { DrizzleStateStore } from "../db/store.server";
import { type CanonicalOp, secretCodeSchema } from "../shared/ops";
import { applyOp } from "../shared/reducer";
import { allocateBins, allocateSchema } from "./allocate";
import { normalizeAccessCode } from "./auth";
import {
  type Ctx,
  error,
  json,
  serializedTransaction,
  sha256Hex,
} from "./context";

type GroupRow = typeof schema.group.$inferSelect;

const withPassword = z.object({ adminPassword: z.string().min(1).max(200) });

const patchSchema = withPassword.extend({
  name: z.string().min(1).max(100).optional(),
  /** Empty string resets to the derived default (stored as null). */
  landingTitle: z.string().max(200).optional(),
  landingSubtitle: z.string().max(200).optional(),
  newAccessCode: z.string().min(4).max(200).optional(),
  newAdminPassword: z.string().min(4).max(200).optional(),
});

const importSchema = withPassword.extend({
  bins: z
    .array(
      z.object({
        id: z.number().int().positive().max(999_999_999),
        code: secretCodeSchema,
      }),
    )
    .min(1)
    .max(1000),
});

const revokeSchema = withPassword.extend({ deviceId: z.string().uuid() });

const binStatusSchema = withPassword.extend({
  binId: z.number().int().positive(),
});

/** A CORS origin like "https://app.example.com" (scheme + host, no path), or *. */
const originSchema = z
  .string()
  .trim()
  .max(200)
  .refine(
    (o) => o === "*" || /^https?:\/\/[^/]+$/.test(o),
    "origin must be scheme://host or *",
  );

const createIntegrationSchema = withPassword.extend({
  label: z.string().min(1).max(100),
  scope: z.enum(["read", "write"]),
  allowedOrigins: z.array(originSchema).max(20).optional(),
});

const revokeIntegrationSchema = withPassword.extend({
  integrationId: z.string().uuid(),
});

/**
 * Mint an opaque integration token `bins_<prefix>_<secret>`. The prefix is
 * stored plaintext so the admin UI can identify a token it otherwise only ever
 * sees the hash of; the secret is what authenticates. Shown to the operator
 * exactly once, at creation.
 */
function newIntegrationToken(): { token: string; prefix: string } {
  const prefix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const secret = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  return { token: `bins_${prefix}_${secret}`, prefix };
}

/** Public view of an integration row (never includes the token or its hash). */
function integrationView(row: typeof schema.device.$inferSelect) {
  return {
    id: row.id,
    label: row.displayName,
    scope: row.scope,
    tokenPrefix: row.tokenPrefix,
    allowedOrigins: row.allowedOrigins ?? [],
    lastSeenAt: row.lastSeenAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
  };
}

/** Returns the caller's group when the admin password checks out. */
async function requireAdmin(
  ctx: Ctx,
  body: unknown,
): Promise<GroupRow | Response> {
  const parsed = withPassword.safeParse(body);
  if (!parsed.success) return error(400, "admin password required");
  const group = await db.query.group.findFirst({
    where: eq(schema.group.id, ctx.groupId),
  });
  if (!group?.adminPasswordHash) {
    return error(403, "admin access is not configured for this group");
  }
  if (sha256Hex(parsed.data.adminPassword) !== group.adminPasswordHash) {
    return error(403, "wrong admin password");
  }
  return group;
}

function configOf(group: GroupRow) {
  return {
    name: group.name,
    landingTitle: group.landingTitle,
    landingSubtitle: group.landingSubtitle,
  };
}

/**
 * Server-author a bin status op (retire/restore). Same shape as allocation:
 * the op is written to the log and applied to the materialized store, then
 * reaches every replica through normal pull. The client triggers a sync after
 * the call so the admin's own device converges promptly.
 */
async function authorBinStatusOp(
  ctx: Ctx,
  binId: number,
  type: "bin.retire" | "bin.restore",
): Promise<void> {
  await serializedTransaction(async () => {
    const store = new DrizzleStateStore(ctx.groupId);
    const now = Date.now();
    const op: CanonicalOp = {
      opId: uuidv7(),
      type,
      binId,
      payload: {},
      clientTime: now,
      geo: null,
      seq: null,
      deviceId: null,
      effectiveTime: now,
    };
    const inserted = await db
      .insert(schema.op)
      .values({
        opId: op.opId,
        groupId: ctx.groupId,
        binId,
        deviceId: null,
        type,
        payload: {},
        clientTime: now,
        effectiveTime: now,
        serverTime: new Date(now),
      })
      .returning({ seq: schema.op.seq });
    op.seq = inserted[0]?.seq ?? null;
    await applyOp(store, op);
  });
}

export async function handleAdmin(
  req: Request,
  ctx: Ctx,
  path: string,
): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  const group = await requireAdmin(ctx, body);
  if (group instanceof Response) return group;

  // Unlock check; returns the RAW config (nulls, not derived defaults) so
  // the admin form can prefill and show defaults as placeholders.
  if (path === "/api/admin/verify") return json({ config: configOf(group) });

  if (path === "/api/admin/group") {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return error(400, "invalid config");
    const p = parsed.data;
    const updates: Partial<GroupRow> = {};
    if (p.name !== undefined) updates.name = p.name.trim();
    if (p.landingTitle !== undefined)
      updates.landingTitle = p.landingTitle.trim() || null;
    if (p.landingSubtitle !== undefined)
      updates.landingSubtitle = p.landingSubtitle.trim() || null;
    if (p.newAccessCode !== undefined)
      updates.accessCodeHash = sha256Hex(normalizeAccessCode(p.newAccessCode));
    if (p.newAdminPassword !== undefined)
      updates.adminPasswordHash = sha256Hex(p.newAdminPassword);
    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.group)
        .set(updates)
        .where(eq(schema.group.id, group.id));
    }
    return json({ config: configOf({ ...group, ...updates }) });
  }

  if (path === "/api/admin/bins/allocate") {
    const parsed = allocateSchema.safeParse(body);
    if (!parsed.success) return error(400, "invalid allocate request");
    const bins = await allocateBins(ctx, parsed.data.count);
    return json({ bins });
  }

  if (path === "/api/admin/bins/retire" || path === "/api/admin/bins/restore") {
    const parsed = binStatusSchema.safeParse(body);
    if (!parsed.success) return error(400, "invalid bin status request");
    // Group-scoped: an admin must never flip a bin outside their group.
    const existing = await db.query.bin.findFirst({
      where: and(
        eq(schema.bin.id, parsed.data.binId),
        eq(schema.bin.groupId, ctx.groupId),
      ),
      columns: { id: true },
    });
    if (!existing) return error(404, "no such bin");
    await authorBinStatusOp(
      ctx,
      parsed.data.binId,
      path.endsWith("retire") ? "bin.retire" : "bin.restore",
    );
    return json({ ok: true });
  }

  if (path === "/api/admin/bins/import") {
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) return error(400, "invalid import");
    const result = await serializedTransaction(async () => {
      const store = new DrizzleStateStore(ctx.groupId);
      const skipped: { id: number; reason: string }[] = [];
      let imported = 0;
      const seen = new Set<number>();
      const now = Date.now();
      for (const bin of parsed.data.bins) {
        // The short-id sequence is GLOBAL across groups — check unscoped.
        if (
          seen.has(bin.id) ||
          (await db.query.bin.findFirst({
            where: eq(schema.bin.id, bin.id),
            columns: { id: true },
          }))
        ) {
          skipped.push({ id: bin.id, reason: "id already exists" });
          continue;
        }
        seen.add(bin.id);
        const op: CanonicalOp = {
          opId: uuidv7(),
          type: "bin.allocate",
          binId: bin.id,
          payload: { code: bin.code },
          clientTime: now,
          geo: null,
          seq: null,
          deviceId: null,
          effectiveTime: now,
        };
        const inserted = await db
          .insert(schema.op)
          .values({
            opId: op.opId,
            groupId: ctx.groupId,
            binId: bin.id,
            deviceId: null,
            type: op.type,
            payload: op.payload,
            clientTime: now,
            effectiveTime: now,
            serverTime: new Date(now),
          })
          .returning({ seq: schema.op.seq });
        op.seq = inserted[0]?.seq ?? null;
        await applyOp(store, op);
        imported++;
      }
      return { imported, skipped };
    });
    return json(result);
  }

  if (path === "/api/admin/devices") {
    // Human devices only — integrations have their own section below.
    const devices = await db.query.device.findMany({
      where: and(
        eq(schema.device.groupId, ctx.groupId),
        eq(schema.device.kind, "member"),
      ),
      columns: { id: true, displayName: true, lastSeenAt: true },
    });
    return json({
      devices: devices.map((d) => ({
        ...d,
        lastSeenAt: d.lastSeenAt?.getTime() ?? null,
        self: d.id === ctx.deviceId,
      })),
    });
  }

  if (path === "/api/admin/devices/revoke") {
    const parsed = revokeSchema.safeParse(body);
    if (!parsed.success) return error(400, "invalid revoke");
    // Group-scoped: an admin must never reach another group's devices.
    await db
      .delete(schema.device)
      .where(
        and(
          eq(schema.device.id, parsed.data.deviceId),
          eq(schema.device.groupId, ctx.groupId),
        ),
      );
    return json({ ok: true });
  }

  if (path === "/api/admin/integrations") {
    const rows = await db.query.device.findMany({
      where: and(
        eq(schema.device.groupId, ctx.groupId),
        eq(schema.device.kind, "integration"),
      ),
    });
    return json({ integrations: rows.map(integrationView) });
  }

  if (path === "/api/admin/integrations/create") {
    const parsed = createIntegrationSchema.safeParse(body);
    if (!parsed.success) return error(400, "invalid integration");
    const { label, scope, allowedOrigins } = parsed.data;
    // A wildcard CORS origin is only defensible for a read-only token.
    if (allowedOrigins?.includes("*") && scope !== "read") {
      return error(400, "wildcard origin allowed only for read scope");
    }
    const { token, prefix } = newIntegrationToken();
    const id = uuidv7();
    await db.insert(schema.device).values({
      id,
      groupId: ctx.groupId,
      displayName: label.trim(),
      tokenHash: sha256Hex(token),
      kind: "integration",
      scope,
      allowedOrigins: allowedOrigins ?? null,
      tokenPrefix: prefix,
    });
    const row = await db.query.device.findFirst({
      where: eq(schema.device.id, id),
    });
    // The raw token is returned exactly once; only its hash is stored.
    return json({ token, integration: row ? integrationView(row) : null });
  }

  if (path === "/api/admin/integrations/revoke") {
    const parsed = revokeIntegrationSchema.safeParse(body);
    if (!parsed.success) return error(400, "invalid revoke");
    // Group-scoped AND kind-scoped: never delete a person's device here.
    await db
      .delete(schema.device)
      .where(
        and(
          eq(schema.device.id, parsed.data.integrationId),
          eq(schema.device.groupId, ctx.groupId),
          eq(schema.device.kind, "integration"),
        ),
      );
    return json({ ok: true });
  }

  return error(404, "no such admin endpoint");
}
