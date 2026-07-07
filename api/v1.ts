/**
 * /api/v1 — the public, versioned read/embed surface for external apps we
 * control. Reads materialized state directly (group-scoped by the token); the
 * sync protocol (/api/sync/*) stays the internal op-log shape. Open to any
 * authenticated token — a read-only integration is enough. Photos are served
 * by the existing bearer-gated /api/blobs/{sha256}: values here expose the
 * hashes, and consumers fetch `/api/blobs/{hash}` with the same token.
 *
 * The sticker `secretCode` is deliberately NEVER exposed here — a read token
 * embedded in a front-end must not leak the codes that mint device tokens.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.server";
import { type Ctx, error, json } from "./context";

/** Public shape of a bin — everything but the sticker secret. */
function binView(row: typeof schema.bin.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    sizeClass: row.sizeClass,
    externalLabel: row.externalLabel,
    weightGrams: row.weightGrams,
    locationName: row.locationName,
    labelIds: row.labelIds ?? [],
    primaryPhotoHash: row.primaryPhotoHash,
    primaryThumbHash: row.primaryThumbHash,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

async function listBins(ctx: Ctx, url: URL): Promise<Response> {
  const location = url.searchParams.get("location");
  const status = url.searchParams.get("status"); // exact status, or omit for all
  const where = [eq(schema.bin.groupId, ctx.groupId)];
  if (location !== null) where.push(eq(schema.bin.locationName, location));
  if (status !== null) where.push(eq(schema.bin.status, status));

  const rows = await db.query.bin.findMany({
    where: and(...where),
    orderBy: [asc(schema.bin.id)],
  });
  return json({ bins: rows.map(binView) });
}

async function getBin(ctx: Ctx, binId: number): Promise<Response> {
  const row = await db.query.bin.findFirst({
    where: and(eq(schema.bin.id, binId), eq(schema.bin.groupId, ctx.groupId)),
  });
  if (!row) return error(404, "no such bin");

  const entries = await db.query.binEntry.findMany({
    where: and(
      eq(schema.binEntry.groupId, ctx.groupId),
      eq(schema.binEntry.binId, binId),
      isNull(schema.binEntry.deletedByOpId),
    ),
    orderBy: [desc(schema.binEntry.effectiveTime), desc(schema.binEntry.id)],
  });

  // Resolve author labels once (small N per bin); unknown/revoked authors and
  // server-authored ops (null deviceId) surface as null.
  const authorIds = [
    ...new Set(
      entries.map((e) => e.deviceId).filter((id): id is string => !!id),
    ),
  ];
  const authors = new Map<string, string>();
  for (const id of authorIds) {
    const dev = await db.query.device.findFirst({
      where: eq(schema.device.id, id),
      columns: { displayName: true },
    });
    if (dev) authors.set(id, dev.displayName);
  }

  return json({
    bin: binView(row),
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      text: e.text,
      photoHash: e.photoHash,
      thumbHash: e.thumbHash,
      originalHash: e.originalHash,
      mime: e.mime,
      author: e.deviceId ? (authors.get(e.deviceId) ?? null) : null,
      effectiveTime: e.effectiveTime,
      geo:
        e.geoLat !== null && e.geoLng !== null
          ? { lat: e.geoLat, lng: e.geoLng, acc: e.geoAcc ?? 0 }
          : null,
    })),
  });
}

async function listLocations(ctx: Ctx): Promise<Response> {
  const rows = await db.query.location.findMany({
    where: eq(schema.location.groupId, ctx.groupId),
    orderBy: [asc(schema.location.sortOrder), asc(schema.location.name)],
    columns: { id: true, name: true, sortOrder: true, archived: true },
  });
  return json({ locations: rows });
}

export async function handleV1(
  req: Request,
  ctx: Ctx,
  path: string,
): Promise<Response> {
  if (req.method !== "GET") return error(405, "method not allowed");
  const url = new URL(req.url);

  if (path === "/api/v1/bins") return await listBins(ctx, url);
  if (path === "/api/v1/locations") return await listLocations(ctx);

  const binMatch = path.match(/^\/api\/v1\/bins\/(\d+)$/);
  if (binMatch?.[1]) return await getBin(ctx, Number(binMatch[1]));

  return error(404, "no such endpoint");
}
