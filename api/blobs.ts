/**
 * Content-addressed photo blob storage. Files live at
 * PHOTOS_PATH/<hash[0:2]>/<hash>; the row in photo_blob scopes visibility to a
 * group. PUT verifies the hash, so retries and duplicate uploads are free
 * (already-exists → 200). Ops may reference a hash before its blob arrives —
 * GET just 404s until then.
 */
import { existsSync } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.server";
import { type Ctx, error, json, sha256Hex } from "./context";

const PHOTOS_PATH = process.env.PHOTOS_PATH ?? "./data/photos";
const MAX_BLOB_BYTES = 15 * 1024 * 1024;

function blobPath(hash: string): string {
  return join(PHOTOS_PATH, hash.slice(0, 2), hash);
}

const HASH_RE = /^[0-9a-f]{64}$/;

export async function handleBlob(
  req: Request,
  ctx: Ctx,
  hash: string,
): Promise<Response> {
  if (!HASH_RE.test(hash)) return error(400, "bad hash");

  if (req.method === "PUT") {
    const existing = await db.query.photoBlob.findFirst({
      where: and(
        eq(schema.photoBlob.groupId, ctx.groupId),
        eq(schema.photoBlob.hash, hash),
      ),
    });
    if (existing && existsSync(blobPath(hash))) return json({ ok: true });

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) return error(400, "empty body");
    if (bytes.length > MAX_BLOB_BYTES) return error(413, "blob too large");
    if (sha256Hex(bytes) !== hash) return error(400, "hash mismatch");

    const path = blobPath(hash);
    await mkdir(dirname(path), { recursive: true });
    // Write to a temp name then rename — readers never see partial files.
    const tmp = `${path}.tmp-${crypto.randomUUID()}`;
    await Bun.write(tmp, bytes);
    try {
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      if (!existsSync(path)) throw err;
    }

    await db
      .insert(schema.photoBlob)
      .values({
        groupId: ctx.groupId,
        hash,
        mime: req.headers.get("content-type") ?? "application/octet-stream",
        size: bytes.length,
        deviceId: ctx.deviceId,
      })
      .onConflictDoNothing();
    return json({ ok: true });
  }

  // HEAD / GET — group-scoped visibility, immutable caching (content-addressed).
  const row = await db.query.photoBlob.findFirst({
    where: and(
      eq(schema.photoBlob.groupId, ctx.groupId),
      eq(schema.photoBlob.hash, hash),
    ),
  });
  if (!row) return error(404, "not found");
  const file = Bun.file(blobPath(hash));
  if (!(await file.exists())) return error(404, "not uploaded yet");

  const headers = {
    "Content-Type": row.mime,
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (req.method === "HEAD") {
    return new Response(null, {
      headers: { ...headers, "Content-Length": String(row.size) },
    });
  }
  return new Response(file, { headers });
}
