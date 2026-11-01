/**
 * Reports: "this is broken" or "make it do this", sent from inside the app.
 *
 * Three audiences:
 * - any member sends one and follows its progress;
 * - an admin sees them all at /admin;
 * - a write-scoped integration (scripts/report-watcher.ts) claims and resolves
 *   them, which is how a report turns into a shipped fix.
 *
 * `trust` is the field that matters most. The watcher OBEYS an admin's report
 * and is wary of everyone else's, so "admin" is only ever set here, from the
 * same check every /api/admin/* call goes through. A wrong or stale password
 * is not refused: it is an ordinary member report, because reporting a problem
 * has to work for someone whose admin session just ran out.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { BUILD_SHA } from "./build";
import { type Ctx, error, json, serializedTransaction } from "./context";

const MAX_TEXT = 4000;
/** Serialized size of the context: on-screen text plus the activity trail. */
const MAX_CONTEXT_BYTES = 40_000;
/** Plenty for someone reporting by hand; a brake on a client gone wrong. */
const MAX_PER_DEVICE_PER_HOUR = 20;
const MAX_ROWS_PER_GROUP = 500;

const REPORT_STATUSES = [
  "open",
  "working",
  "fixed",
  "declined",
  "needs_human",
] as const;

const createSchema = z.object({
  /** Device-minted, so a retried upload lands once. */
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(MAX_TEXT),
  route: z.string().max(500).nullish(),
  buildSha: z.string().max(64).nullish(),
  userAgent: z.string().max(300).nullish(),
  context: z.record(z.string(), z.unknown()).nullish(),
  screenshotHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
  /** The device's cached credential; see `trustOf`. */
  adminPassword: z.string().max(200).optional(),
  /** When it was written, which may be long before it got signal. */
  at: z.number().int().nonnegative().optional(),
});

const updateSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  resolution: z.string().trim().max(500).nullish(),
  fixedInBuild: z.string().max(64).nullish(),
  /**
   * Compare-and-set. A watcher claims with `expectStatus: "open"`, so two
   * watchers, or a restart racing an admin dismissing the report, can't both
   * act on it.
   */
  expectStatus: z.enum(REPORT_STATUSES).optional(),
});

/** A watcher beats every 15 s, so this survives a few lost ones. */
const AGENT_OFFLINE_AFTER_MS = 75_000;

const heartbeatSchema = z.object({
  stage: z.enum([
    "idle",
    "fixing",
    "checking",
    "reviewing",
    "publishing",
    "deploying",
  ]),
  /** Which report it's on; null when idle. */
  reportId: z.string().uuid().nullish(),
  /** 0 to 1. An estimate from the watcher's own past runs. */
  progress: z.number().min(0).max(1).nullish(),
  etaSeconds: z.number().int().nonnegative().nullish(),
});

type Heartbeat = z.infer<typeof heartbeatSchema> & { at: number };

/**
 * The latest beat per group, in memory on purpose. It goes stale within a
 * minute anyway, and a restart costs one beat's worth of "offline".
 */
const heartbeats = new Map<string, Heartbeat>();

async function agentStatus(groupId: string) {
  const queue = await db.query.report.findMany({
    where: and(
      eq(schema.report.groupId, groupId),
      inArray(schema.report.status, ["open", "working"]),
    ),
    columns: { id: true },
  });
  const beat = heartbeats.get(groupId);
  const online = !!beat && Date.now() - beat.at < AGENT_OFFLINE_AFTER_MS;
  return {
    online,
    stage: online ? beat.stage : null,
    reportId: online ? (beat.reportId ?? null) : null,
    progress: online ? (beat.progress ?? null) : null,
    etaSeconds: online ? (beat.etaSeconds ?? null) : null,
    queued: queue.length,
  };
}

const adminUpdateSchema = z.object({
  reportId: z.string().uuid(),
  status: z.enum(["open", "declined"]),
});

async function trustOf(ctx: Ctx, adminPassword: string | undefined) {
  // Imported here because admin.ts imports this module for its routes.
  const { requireAdmin } = await import("./admin");
  const verdict = await requireAdmin(ctx, { adminPassword });
  return verdict instanceof Response ? "member" : "admin";
}

export async function handleReportCreate(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "invalid report");
  const body = parsed.data;

  // Too much context is not a reason to lose the report.
  let context = body.context ?? null;
  if (context && JSON.stringify(context).length > MAX_CONTEXT_BYTES) {
    context = { truncated: true };
  }

  const trust = await trustOf(ctx, body.adminPassword);
  const refusal = await serializedTransaction(async () => {
    // Before the rate limit, so a device's retry of a report that DID land
    // reads as success instead of being counted against it.
    const existing = await db.query.report.findFirst({
      where: eq(schema.report.id, body.id),
      columns: { groupId: true },
    });
    if (existing) {
      return existing.groupId === ctx.groupId ? null : error(409, "id in use");
    }

    const recent = await db.query.report.findMany({
      where: and(
        eq(schema.report.deviceId, ctx.deviceId),
        gte(schema.report.createdAt, new Date(Date.now() - 3_600_000)),
      ),
      columns: { id: true },
    });
    if (recent.length >= MAX_PER_DEVICE_PER_HOUR) {
      return error(429, "too many reports");
    }

    const createdAt = new Date(body.at ?? Date.now());
    await db.insert(schema.report).values({
      id: body.id,
      groupId: ctx.groupId,
      deviceId: ctx.deviceId,
      reporterName: ctx.displayName,
      trust,
      text: body.text,
      route: body.route ?? null,
      buildSha: body.buildSha ?? null,
      userAgent: body.userAgent ?? null,
      context,
      screenshotHash: body.screenshotHash ?? null,
      createdAt,
      updatedAt: createdAt,
    });

    // Cap the table, oldest first. Sliced in JS for the reason api/errors.ts
    // gives: SQLite wants a LIMIT before an OFFSET, and this list is tiny.
    const all = await db.query.report.findMany({
      where: eq(schema.report.groupId, ctx.groupId),
      columns: { id: true },
      orderBy: [desc(schema.report.createdAt)],
    });
    const excess = all.slice(MAX_ROWS_PER_GROUP).map((row) => row.id);
    if (excess.length > 0) {
      await db.delete(schema.report).where(inArray(schema.report.id, excess));
    }
    return null;
  });

  return refusal ?? json({ ok: true, trust });
}

/** Just what a reporter needs to follow their own reports. */
export async function handleReportsMine(ctx: Ctx): Promise<Response> {
  const rows = await db.query.report.findMany({
    where: eq(schema.report.deviceId, ctx.deviceId),
    orderBy: [desc(schema.report.createdAt)],
    limit: 20,
  });
  return json({
    // A device compares this with its own build to tell whether a fix has
    // reached it yet.
    serverBuild: BUILD_SHA,
    agent: await agentStatus(ctx.groupId),
    reports: rows.map((r) => ({
      id: r.id,
      text: r.text.slice(0, 120),
      status: r.status,
      resolution: r.resolution,
      fixedInBuild: r.fixedInBuild,
    })),
  });
}

function fullView(row: typeof schema.report.$inferSelect) {
  return {
    id: row.id,
    reporterName: row.reporterName,
    trust: row.trust,
    text: row.text,
    route: row.route,
    buildSha: row.buildSha,
    userAgent: row.userAgent,
    context: row.context,
    screenshotHash: row.screenshotHash,
    status: row.status,
    resolution: row.resolution,
    fixedInBuild: row.fixedInBuild,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function handleAdminReportList(ctx: Ctx): Promise<Response> {
  const rows = await db.query.report.findMany({
    where: eq(schema.report.groupId, ctx.groupId),
    orderBy: [desc(schema.report.createdAt)],
    limit: 100,
  });
  return json({ reports: rows.map(fullView) });
}

/** Admin: dismiss a report, or put it back in the watcher's queue. */
export async function handleAdminReportUpdate(
  ctx: Ctx,
  body: unknown,
): Promise<Response> {
  const parsed = adminUpdateSchema.safeParse(body);
  if (!parsed.success) return error(400, "invalid update");
  await db
    .update(schema.report)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.report.id, parsed.data.reportId),
        eq(schema.report.groupId, ctx.groupId),
      ),
    );
  return json({ ok: true });
}

/**
 * The watcher's side, under /api/v1. Write scope only: reports hold other
 * people's on-screen data, and a read token is allowed to sit in a front-end.
 */
export async function handleV1Reports(
  req: Request,
  ctx: Ctx,
  path: string,
): Promise<Response> {
  if (ctx.kind !== "integration" || ctx.scope !== "write") {
    return error(403, "write-scoped integration required");
  }

  if (path === "/api/v1/reports" && req.method === "GET") {
    const status = new URL(req.url).searchParams.get("status") ?? "open";
    const rows = await db.query.report.findMany({
      where: and(
        eq(schema.report.groupId, ctx.groupId),
        eq(schema.report.status, status),
      ),
      // Oldest first: this is a queue.
      orderBy: [schema.report.createdAt],
      limit: 50,
    });
    return json({ reports: rows.map(fullView) });
  }

  if (path === "/api/v1/reports/heartbeat" && req.method === "POST") {
    const beat = heartbeatSchema.safeParse(await req.json().catch(() => null));
    if (!beat.success) return error(400, "invalid heartbeat");
    heartbeats.set(ctx.groupId, { ...beat.data, at: Date.now() });
    return json({ ok: true });
  }

  const match = path.match(/^\/api\/v1\/reports\/([0-9a-f-]{36})$/i);
  if (!match?.[1] || req.method !== "POST") {
    return error(404, "no such endpoint");
  }
  const reportId = match[1];
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "invalid update");
  const { status, resolution, fixedInBuild, expectStatus } = parsed.data;

  return await serializedTransaction(async () => {
    const row = await db.query.report.findFirst({
      where: and(
        eq(schema.report.id, reportId),
        eq(schema.report.groupId, ctx.groupId),
      ),
    });
    if (!row) return error(404, "no such report");
    if (expectStatus && row.status !== expectStatus) {
      return error(409, `report is ${row.status}`);
    }
    await db
      .update(schema.report)
      .set({
        status,
        updatedAt: new Date(),
        ...(resolution !== undefined ? { resolution } : {}),
        ...(fixedInBuild !== undefined ? { fixedInBuild } : {}),
      })
      .where(eq(schema.report.id, reportId));
    return json({ ok: true });
  });
}
