/**
 * Reading contents photos, so a box that was only ever photographed can still
 * be found by typing what is in it.
 *
 * This is the gap the feature exists to close. Snapping a photo is the fast
 * path in the capture flow, and `app/lib/search.ts` indexes names, subtext,
 * places, categories and notes — none of which a photo contributes to. So a
 * meaningful share of boxes are, today, unfindable by text. Reading each
 * photo once and writing the words next to it fixes that for the offline
 * search as much as for the assistant, because the description syncs to every
 * replica like any other state.
 *
 * Costs real money per photo, so: opt-in for the automatic path
 * (AI_CAPTION_PHOTOS), always available as an explicit admin backfill that
 * shows the bill first, cached by photo hash so nothing is read twice, and
 * under the same monthly ceiling as everything else.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, schema } from "../../db/client.server";
import { DrizzleStateStore } from "../../db/store.server";
import type { CanonicalOp } from "../../shared/ops";
import { applyOp } from "../../shared/reducer";
import { readBlob } from "../blobs";
import { serializedTransaction } from "../context";
import { forgetSnapshot } from "./catalog";
import { askAi, selectProvider } from "./provider";
import { AiBudgetError, AiUnavailableError, type JsonSchema } from "./types";

/**
 * How many photos one run will read. A backfill of a real group is hundreds
 * of images; doing them in bounded batches keeps a single request short, lets
 * the budget ceiling stop things between batches rather than mid-flight, and
 * makes "run it again" the obvious way to continue.
 */
export const CAPTION_BATCH = 25;

const ITEMS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description:
        "What is in the box, one short phrase per distinct thing. Empty if nothing is identifiable.",
      items: { type: "string" },
    },
  },
  required: ["items"],
};

/**
 * Written for retrieval, not description.
 *
 * The output is fed to a keyword index and to the assistant's catalog, so
 * what matters is the words a person would actually type months later. That
 * makes "3 USB-C cables" worse than "USB-C cables" (nobody searches for the
 * count) and "a cardboard box containing various items" worthless.
 */
const CAPTION_PROMPT = `You are looking into a storage box. List what is in it.

- One short phrase per distinct kind of thing. No counts, no colours unless they identify the object ("yellow extension cord" only if that is how someone would ask for it).
- Name things the way the owner would search for them later: "USB-C cables", "drill bits", "Christmas lights", "paint rollers".
- Use the specific name when you can tell ("circular saw", not "power tool") and the general one when you cannot.
- Ignore the box, the bag, the packaging and the background. They are not contents.
- Do not guess at what might be underneath or inside something you cannot see into.
- If the picture is too dark, too blurry, or too ambiguous to name anything, return an empty list. That is a useful answer and a better one than a guess.`;

export type CaptionStatus = {
  available: boolean;
  /** Live contents photos with no description for the current model. */
  pending: number;
  model: string | null;
  /** Rough USD for clearing the whole backlog — shown before spending it. */
  estimateUsd: number;
  automatic: boolean;
};

/** Automatic captioning of new photos. Off unless the operator asks for it. */
export function captionAutomatically(): boolean {
  const raw = process.env.AI_CAPTION_PHOTOS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * A photo costs roughly this many input tokens, plus a short answer.
 *
 * A deliberate over-estimate of a ~1600px image so the figure shown to an
 * admin is never lower than the bill. It is a decision aid, not accounting —
 * the ledger records what was actually spent.
 */
const TOKENS_PER_PHOTO = 1800;
const TOKENS_PER_ANSWER = 120;

/** Live, undeleted contents photos that no model has described yet. */
async function pendingEntries(groupId: string, limit?: number) {
  return await db.query.binEntry.findMany({
    where: and(
      eq(schema.binEntry.groupId, groupId),
      eq(schema.binEntry.kind, "contents_photo"),
      isNull(schema.binEntry.deletedByOpId),
      isNull(schema.binEntry.aiItems),
      sql`${schema.binEntry.photoHash} is not null`,
    ),
    // Newest first: the most recently added boxes are the ones someone is
    // most likely to go looking for, and a backfill may never finish.
    orderBy: (entry, { desc }) => [desc(entry.effectiveTime)],
    ...(limit ? { limit } : {}),
  });
}

export async function captionStatus(groupId: string): Promise<CaptionStatus> {
  const selection = selectProvider();
  const pending = await pendingEntries(groupId);
  const pricing = selection?.pricing;
  const perPhoto = pricing
    ? (TOKENS_PER_PHOTO * pricing.inputUsd +
        TOKENS_PER_ANSWER * pricing.outputUsd) /
      1_000_000
    : 0;
  return {
    available: selection !== null,
    pending: pending.length,
    model: selection?.model ?? null,
    estimateUsd: perPhoto * pending.length,
    automatic: captionAutomatically(),
  };
}

/** The cached answer for this exact image and model, if there is one. */
async function cachedItems(
  hash: string,
  model: string,
): Promise<string[] | null> {
  const row = await db.query.aiCaption.findFirst({
    where: and(
      eq(schema.aiCaption.hash, hash),
      eq(schema.aiCaption.model, model),
    ),
  });
  return row?.items ?? null;
}

/**
 * Write the description onto the entry, as an op.
 *
 * An op rather than a direct row update because that is the invariant the
 * whole system rests on: materialized tables are only ever written by the
 * reducer, and it is also the only way these words reach anyone's phone.
 */
async function authorItemsOp(
  groupId: string,
  binId: number,
  entryOpId: string,
  photoHash: string,
  items: string[],
  model: string,
): Promise<void> {
  await serializedTransaction(async () => {
    const store = new DrizzleStateStore(groupId);
    const now = Date.now();
    const payload = { entryOpId, photoHash, items, model };
    const op: CanonicalOp = {
      opId: uuidv7(),
      type: "entry.setAiItems",
      binId,
      payload,
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
        groupId,
        binId,
        deviceId: null,
        type: op.type,
        payload,
        clientTime: now,
        effectiveTime: now,
        serverTime: new Date(now),
      })
      .returning({ seq: schema.op.seq });
    op.seq = inserted[0]?.seq ?? null;
    await applyOp(store, op);
  });
}

export type CaptionRun = {
  described: number;
  fromCache: number;
  /** Left over after this batch — run again to continue. */
  remaining: number;
  costUsd: number;
  /** Set when the run stopped early; the batch so far is still committed. */
  stoppedBecause: string | null;
};

/**
 * Describe up to `limit` undescribed photos.
 *
 * Each photo is committed as it completes rather than batched at the end: a
 * run that hits the budget ceiling or a provider outage halfway should keep
 * what it already paid for, not throw it away.
 */
export async function captionPending(
  groupId: string,
  limit = CAPTION_BATCH,
): Promise<CaptionRun> {
  const selection = selectProvider();
  if (!selection) throw new AiUnavailableError("no AI provider configured");
  const model = selection.model;

  const entries = await pendingEntries(groupId, limit);
  const run: CaptionRun = {
    described: 0,
    fromCache: 0,
    remaining: 0,
    costUsd: 0,
    stoppedBecause: null,
  };

  for (const entry of entries) {
    const hash = entry.photoHash;
    if (!hash) continue;
    try {
      let items = await cachedItems(hash, model);
      if (items === null) {
        // Group-scoped read: a hash alone must never reach across tenants.
        const blob = await readBlob(groupId, hash);
        if (!blob) {
          // The op arrived but the upload has not (or the file is gone).
          // Skipping leaves it pending, which is right — it may show up.
          continue;
        }
        const answer = await askAi("caption", {
          layers: [{ stable: true, text: CAPTION_PROMPT }],
          question: "List what is in this box.",
          image: {
            mime: entry.mime || "image/jpeg",
            base64: blob.toString("base64"),
          },
          schema: ITEMS_SCHEMA,
          maxOutputTokens: 500,
        });
        const raw = (answer.json ?? {}) as { items?: unknown };
        items = Array.isArray(raw.items)
          ? raw.items
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, 40)
          : [];
        run.costUsd += answer.costUsd;
        await db
          .insert(schema.aiCaption)
          .values({ hash, model, items })
          .onConflictDoNothing();
      } else {
        run.fromCache += 1;
      }

      await authorItemsOp(groupId, entry.binId, entry.id, hash, items, model);
      run.described += 1;
    } catch (err) {
      // A ceiling reached mid-backfill is the expected way for a big run to
      // end, not a failure — report it and keep what was already written.
      if (err instanceof AiBudgetError) {
        run.stoppedBecause = err.message;
        break;
      }
      throw err;
    }
  }

  // The descriptions are part of what the assistant reads, so its cached
  // snapshot is now out of date by more than a tail entry's worth.
  if (run.described > 0) forgetSnapshot(groupId);
  run.remaining = (await pendingEntries(groupId)).length;
  return run;
}

/**
 * Fire-and-forget captioning after a push, when the operator has opted in.
 *
 * Single-flight per group: a burst of photo uploads from one phone should
 * queue one run, not one per push. Failures are logged and dropped — a push
 * must never fail because a description could not be written.
 */
const running = new Set<string>();

export function scheduleCaptioning(groupId: string): void {
  if (!captionAutomatically() || running.has(groupId)) return;
  running.add(groupId);
  void captionPending(groupId)
    .catch((err) => {
      console.error(`automatic captioning failed for ${groupId}:`, err);
    })
    .finally(() => {
      running.delete(groupId);
    });
}
