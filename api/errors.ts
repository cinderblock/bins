/**
 * Ingest for errors that happened in someone's browser.
 *
 * Until this existed, a user hitting an error produced no record anywhere —
 * the only trace of a real one was somebody typing "Ran out of photo space"
 * into a box's notes. Several of this app's worst bugs (a shell that couldn't
 * boot, route chunks 404ing after a deploy, a hooks-order crash) were silent
 * for exactly the same reason.
 *
 * Deduplicated server-side by fingerprint so a crash loop climbs a counter
 * instead of filling the disk, and capped per group so a hostile or broken
 * client can't grow the database without bound.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import {
  type Ctx,
  error,
  json,
  serializedTransaction,
  sha256Hex,
} from "./context";

/** Plenty for a stack; short enough that nothing can post a novel. */
const MAX_STACK = 4000;
const MAX_MESSAGE = 500;

/** Distinct problems kept per group. Oldest-by-last-seen is evicted first. */
const MAX_ROWS_PER_GROUP = 200;

const reportSchema = z.object({
  errors: z
    .array(
      z.object({
        kind: z.string().min(1).max(40),
        message: z.string().min(1).max(MAX_MESSAGE),
        stack: z.string().max(MAX_STACK).nullish(),
        route: z.string().max(200).nullish(),
        buildSha: z.string().max(64).nullish(),
        userAgent: z.string().max(300).nullish(),
        /** When it happened on the device — may be long before it uploads. */
        at: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * What makes two reports "the same problem": the build, the kind, the message
 * and the first stack frame. Deliberately NOT the whole stack — differing line
 * numbers deeper in a trace are the same bug.
 */
function fingerprintOf(e: {
  kind: string;
  message: string;
  stack?: string | null;
  buildSha?: string | null;
}): string {
  const frame = (e.stack ?? "").split("\n")[1]?.trim() ?? "";
  return sha256Hex(`${e.buildSha ?? ""}|${e.kind}|${e.message}|${frame}`);
}

export async function handleErrorReport(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const parsed = reportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "invalid error report");

  await serializedTransaction(async () => {
    for (const e of parsed.data.errors) {
      const fingerprint = fingerprintOf(e);
      const seenAt = new Date(e.at ?? Date.now());
      const existing = await db.query.clientError.findFirst({
        where: and(
          eq(schema.clientError.groupId, ctx.groupId),
          eq(schema.clientError.fingerprint, fingerprint),
        ),
      });
      if (existing) {
        await db
          .update(schema.clientError)
          .set({
            count: existing.count + 1,
            lastSeenAt:
              seenAt > existing.lastSeenAt ? seenAt : existing.lastSeenAt,
          })
          .where(eq(schema.clientError.id, existing.id));
        continue;
      }
      await db.insert(schema.clientError).values({
        id: crypto.randomUUID(),
        groupId: ctx.groupId,
        deviceId: ctx.deviceId,
        fingerprint,
        kind: e.kind,
        message: e.message,
        stack: e.stack ?? null,
        route: e.route ?? null,
        buildSha: e.buildSha ?? null,
        userAgent: e.userAgent ?? null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
    }

    // Cap the table. Keeping the most RECENTLY seen matters more than the
    // most frequent: a loud bug already fixed is less useful than a quiet one
    // still happening.
    // Sliced in JS rather than with OFFSET: SQLite requires a LIMIT before an
    // OFFSET, and the row count here is bounded and tiny anyway.
    const all = await db.query.clientError.findMany({
      where: eq(schema.clientError.groupId, ctx.groupId),
      columns: { id: true },
      orderBy: [desc(schema.clientError.lastSeenAt)],
    });
    for (const row of all.slice(MAX_ROWS_PER_GROUP)) {
      await db
        .delete(schema.clientError)
        .where(eq(schema.clientError.id, row.id));
    }
  });

  return json({ ok: true });
}

/** Admin view: distinct problems, worst-recent first. */
export async function handleErrorList(ctx: Ctx): Promise<Response> {
  const rows = await db.query.clientError.findMany({
    where: eq(schema.clientError.groupId, ctx.groupId),
    orderBy: [desc(schema.clientError.lastSeenAt)],
    limit: 100,
  });
  return json({
    errors: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      message: r.message,
      stack: r.stack,
      route: r.route,
      buildSha: r.buildSha,
      userAgent: r.userAgent,
      count: r.count,
      firstSeenAt: r.firstSeenAt.getTime(),
      lastSeenAt: r.lastSeenAt.getTime(),
    })),
  });
}

/** Admin: clear everything once it's been triaged. */
export async function handleErrorClear(ctx: Ctx): Promise<Response> {
  await db
    .delete(schema.clientError)
    .where(eq(schema.clientError.groupId, ctx.groupId));
  return json({ ok: true });
}
