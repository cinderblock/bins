/**
 * The two questions people actually ask in a storage space:
 *
 *   place — "I have a box of USB cables. Which box, or start a new one?"
 *   find  — "Where would I find the good extension cords?"
 *
 * Both run over the same layered catalog (catalog.ts) and differ only in
 * framing, which is why they share a backend and a response shape.
 *
 * The model never writes anything. It returns box numbers and reasons; a
 * person taps through to the box and acts. Nothing here authors an op.
 */
import { locationLabel } from "@shared/locations";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/client.server";
import { type Ctx, error, json } from "../context";
import { buildCatalogLayers } from "./catalog";
import { dbCatalogSource } from "./catalog.db";
import { askAi } from "./provider";
import type { AiLayer, JsonSchema } from "./types";

export const askRequestSchema = z.object({
  kind: z.enum(["place", "find"]),
  /** What the person typed. Short by nature — this is a question, not a doc. */
  query: z.string().trim().min(1).max(500),
});
export type AskRequestInput = z.infer<typeof askRequestSchema>;

/**
 * One shape for both questions.
 *
 * Every field is required and nothing is nullable — see JsonSchema in
 * types.ts. A `find` answer simply reports `newBox: false` and empty strings
 * for the placement-only fields, which costs a few tokens and saves the app
 * from branching over two response types.
 */
const ANSWER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "One or two plain sentences answering the question directly. No preamble.",
    },
    boxes: {
      type: "array",
      description:
        "Candidate boxes, best first, at most four. Empty if none fit.",
      items: {
        type: "object",
        properties: {
          id: {
            type: "integer",
            description: "The box number exactly as it appears in BOXES.",
          },
          reason: {
            type: "string",
            description: "One short clause on why this box.",
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["id", "reason", "confidence"],
      },
    },
    newBox: {
      type: "boolean",
      description:
        "Placement only: true if a new box should be started instead of using an existing one. Always false when finding.",
    },
    newBoxReason: {
      type: "string",
      description:
        "Why a new box is the right call. Empty string when newBox is false.",
    },
    suggestedPlace: {
      type: "string",
      description:
        "Placement only: where the box should physically sit, naming a place (and slot, if that place has them) from PLACES. Empty string if there is no good suggestion.",
    },
  },
  required: ["answer", "boxes", "newBox", "newBoxReason", "suggestedPlace"],
};

const PLACE_FRAMING = `You help a group decide where to put things in their storage boxes.

You will be given the group's category vocabulary, its places, and every active box with what is recorded about it. Answer only from that.

Rules:
- Only ever name box numbers that appear in the BOXES list. Never invent one.
- Prefer a box whose existing contents and categories already match what is being stored. Keeping like with like is the point.
- Judge whether there is room from the fill percentage and the box size. A box at 90% is not a candidate for a bulky item.
- Recommend starting a new box when nothing matches well, or when every good match is nearly full. Say so plainly — a new box is a normal answer, not a failure.
- A box whose contents are recorded only as a photo has UNKNOWN contents. Do not assume it is empty, and do not rule it out; mention the uncertainty.
- If the group has written sorting conventions, they outrank your own instincts about what goes with what.
- Suggest a physical place only when the places list gives you a basis for it.
- Be decisive and brief. Two or three candidates is more useful than a survey.`;

const FIND_FRAMING = `You help someone find something in a group's storage boxes.

You will be given the group's category vocabulary, its places, and every active box with what is recorded about it. Answer only from that.

Rules:
- Only ever name box numbers that appear in the BOXES list. Never invent one.
- Rank by how likely the thing is to actually be in that box, best first.
- Match on meaning, not just words. A search for "extension cords" should surface a box recorded as holding "power cables".
- A box whose contents are recorded only as a photo has UNKNOWN contents. If it is plausible on category or location, include it and say the contents were never written down.
- If nothing plausibly matches, return an empty list and say so rather than reaching for the least-bad box.
- Say where each box physically is, when that is recorded — the point is to walk to it.
- Be brief. The answer is read standing up, on a phone.`;

/**
 * Per-device ceiling, alongside the money one.
 *
 * The budget in budget.ts stops a runaway month; this stops a single device
 * (a stuck retry loop, someone holding the button) from consuming it in an
 * afternoon. In memory, so a restart forgives — which is the right trade for
 * a guard rail that should never be the reason someone can't find their
 * extension cords.
 */
const RATE_LIMIT_PER_HOUR = 40;
const recentCalls = new Map<string, number[]>();

function rateLimited(deviceId: string): boolean {
  const now = Date.now();
  const hourAgo = now - 3_600_000;
  const calls = (recentCalls.get(deviceId) ?? []).filter((at) => at > hourAgo);
  if (calls.length >= RATE_LIMIT_PER_HOUR) {
    recentCalls.set(deviceId, calls);
    return true;
  }
  calls.push(now);
  recentCalls.set(deviceId, calls);
  return false;
}

type RawAnswer = {
  answer?: unknown;
  boxes?: unknown;
  newBox?: unknown;
  newBoxReason?: unknown;
  suggestedPlace?: unknown;
};

export type AskedBox = {
  id: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  /** Resolved server-side from the box row, never from the model. */
  name: string | null;
  location: string | null;
  /** Needed to build the link on internal-number deployments (lib/boxRef). */
  handle: string | null;
};

/**
 * Keep only box numbers that really exist, in this group, and are active.
 *
 * Structured output constrains the SHAPE of the reply, not its truthfulness —
 * a model can still return a plausible-looking number for a box that was
 * retired last week or belongs to another tenant. Since every id becomes a
 * tappable link, an unchecked one is a 404 in someone's hand, so the rows are
 * re-read here and the name and location come from the database rather than
 * from the answer.
 */
async function resolveBoxes(
  groupId: string,
  raw: unknown,
): Promise<AskedBox[]> {
  if (!Array.isArray(raw)) return [];
  const proposed = raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      id: Number(item.id),
      reason: typeof item.reason === "string" ? item.reason : "",
      // Anything the model returns outside the three known levels reads as
      // the middle one rather than failing the whole answer.
      confidence:
        item.confidence === "high"
          ? ("high" as const)
          : item.confidence === "low"
            ? ("low" as const)
            : ("medium" as const),
    }))
    .filter((item) => Number.isInteger(item.id))
    .slice(0, 4);
  if (!proposed.length) return [];

  const rows = await db.query.bin.findMany({
    where: and(
      eq(schema.bin.groupId, groupId),
      inArray(
        schema.bin.id,
        proposed.map((item) => item.id),
      ),
    ),
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const places = await db.query.location.findMany({
    where: eq(schema.location.groupId, groupId),
  });
  const placesById = new Map(places.map((place) => [place.id, place]));

  const resolved: AskedBox[] = [];
  for (const item of proposed) {
    const row = byId.get(item.id);
    if (!row || row.status !== "active") continue;
    const slot = row.slot ? ` · slot ${row.slot}` : "";
    resolved.push({
      ...item,
      name: row.name,
      handle: row.handle,
      location: row.locationId
        ? `${locationLabel(placesById, row.locationId)}${slot}`
        : row.locationName,
    });
  }
  return resolved;
}

export async function handleAsk(
  ctx: Ctx,
  input: AskRequestInput,
): Promise<Response> {
  if (rateLimited(ctx.deviceId))
    return error(429, "too many questions in the last hour — try again later");

  const group = await db.query.group.findFirst({
    where: eq(schema.group.id, ctx.groupId),
  });
  if (!group) return error(403, "no such group");

  const framing = input.kind === "place" ? PLACE_FRAMING : FIND_FRAMING;
  const layers: AiLayer[] = [{ stable: true, text: framing }];
  // The group's own conventions outrank everything the model assumes about
  // what belongs with what — and they are the one thing it cannot infer.
  if (group.sortingNotes?.trim()) {
    layers.push({
      stable: true,
      text: `HOW THIS GROUP SORTS THINGS (follow this over your own instincts)\n${group.sortingNotes.trim()}`,
    });
  }
  const catalog = await buildCatalogLayers(ctx.groupId, dbCatalogSource);
  layers.push(...catalog.layers);

  const result = await askAi("ask", {
    layers,
    question:
      input.kind === "place"
        ? `Where should this go? ${input.query}`
        : `Where would I find this? ${input.query}`,
    schema: ANSWER_SCHEMA,
    maxOutputTokens: 1200,
  });

  const raw = (result.json ?? {}) as RawAnswer;
  return json({
    answer: typeof raw.answer === "string" ? raw.answer : "",
    boxes: await resolveBoxes(ctx.groupId, raw.boxes),
    newBox: raw.newBox === true,
    newBoxReason: typeof raw.newBoxReason === "string" ? raw.newBoxReason : "",
    suggestedPlace:
      typeof raw.suggestedPlace === "string" ? raw.suggestedPlace : "",
    // Shown in settings/admin rather than the answer card — an operator
    // paying per question deserves to see what each one cost.
    meta: {
      provider: result.provider,
      model: result.model,
      costUsd: result.costUsd,
      bins: catalog.bins,
      tailOps: catalog.tailOps,
      cachedInputTokens: result.usage.cachedInputTokens,
    },
  });
}
