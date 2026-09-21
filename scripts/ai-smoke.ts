/**
 * Prove the AI features actually work against a real provider.
 *
 *   bun scripts/ai-smoke.ts                  # two questions, no photos read
 *   bun scripts/ai-smoke.ts --caption        # ...and describe ONE photo
 *   bun scripts/ai-smoke.ts --ask "drill"    # your own question
 *
 * Everything in api/ai/ is covered by hermetic tests, which means the one
 * thing never exercised is the part that leaves the machine: the three
 * providers' request shapes are written from their documentation and have
 * never had a real 200 back. This is the cheapest way to find out — one
 * command, a few cents, and it prints the bill.
 *
 * SPENDS REAL MONEY. Two questions on a small catalog is a fraction of a
 * cent; --caption adds one image. Run it against a dev database first.
 */
import { handleAsk } from "../api/ai/ask";
import { captionPending, captionStatus } from "../api/ai/caption";
import { buildCatalogLayers } from "../api/ai/catalog";
import { aiStatus } from "../api/ai/provider";
import type { Ctx } from "../api/context";
import { db } from "../db/client.server";

const args = process.argv.slice(2);
const wantCaption = args.includes("--caption");
const askIndex = args.indexOf("--ask");
const customQuery = askIndex >= 0 ? args[askIndex + 1] : null;

function usd(n: number): string {
  return n < 0.01 && n > 0 ? `<$0.01 (${n.toFixed(6)})` : `$${n.toFixed(4)}`;
}

const status = aiStatus();
console.log("provider:", status.provider ?? "(none configured)");
console.log("model:   ", status.model ?? "-");
console.log(
  "budget:  ",
  status.budgetUsd === null ? "NO CEILING" : `$${status.budgetUsd}`,
);
console.log("spent:   ", usd(status.spentUsd), status.spentByFeature);

if (!status.available) {
  console.error(
    "\nNo provider configured. Set GEMINI_API_KEY (or OPENAI_API_KEY /" +
      " ANTHROPIC_API_KEY plus AI_PROVIDER) and try again.\n" +
      "Locally, a .env in the project root is enough — Bun loads it.",
  );
  process.exit(1);
}
if (status.budgetUsd === null) {
  // Not fatal: a smoke run is small. But an uncapped deployment is the one
  // configuration mistake here that can cost real money quietly.
  console.warn("\n! AI_BUDGET_USD is unset — there is no monthly ceiling.");
}

const group = await db.query.group.findFirst();
if (!group) {
  console.error("\nNo group in this database. Run the setup wizard first.");
  process.exit(1);
}
console.log(`\ngroup:    ${group.name} (${group.id})`);
if (!group.sortingNotes?.trim())
  console.log("          (no sorting conventions set — /admin can add them)");

const catalog = await buildCatalogLayers(group.id);
const chars = catalog.layers.reduce((n, l) => n + l.text.length, 0);
console.log(
  `catalog:  ${catalog.bins} boxes, ${catalog.tailOps} tail ops, ~${Math.round(chars / 4)} tokens`,
);
if (catalog.bins === 0) {
  console.error("\nNo active boxes — nothing to ask about.");
  process.exit(1);
}

/** The smoke test talks to the handler, so the real request path is covered. */
const ctx: Ctx = {
  deviceId: "ai-smoke",
  groupId: group.id,
  displayName: "smoke test",
  kind: "member",
  scope: null,
  allowedOrigins: null,
  adminUntil: null,
};

async function ask(kind: "find" | "place", query: string) {
  console.log(`\n── ${kind}: "${query}"`);
  const started = Date.now();
  const res = await handleAsk(ctx, { kind, query });
  const body = (await res.json()) as Record<string, unknown>;
  if (res.status !== 200) {
    console.error(`  FAILED ${res.status}:`, body.error);
    return false;
  }
  const meta = body.meta as Record<string, number | string>;
  console.log(`  ${body.answer}`);
  for (const box of body.boxes as {
    id: number;
    reason: string;
    confidence: string;
  }[])
    console.log(`  → #${box.id} (${box.confidence}) — ${box.reason}`);
  if (body.newBox) console.log(`  → NEW BOX: ${body.newBoxReason}`);
  if (body.suggestedPlace) console.log(`  → place: ${body.suggestedPlace}`);
  console.log(
    `  ${Date.now() - started}ms · ${usd(meta.costUsd as number)} · cached ${meta.cachedInputTokens} tok`,
  );
  return true;
}

let ok = true;
ok = (await ask("find", customQuery ?? "extension cords")) && ok;
// Deliberately second: the catalog prefix is identical, so a non-zero
// `cached` figure here is the caching design working end to end.
ok = (await ask("place", customQuery ?? "a box of USB-C cables")) && ok;

if (wantCaption) {
  const before = await captionStatus(group.id);
  console.log(`\n── caption: ${before.pending} photos pending`);
  if (before.pending === 0) {
    console.log("  nothing to read");
  } else {
    const run = await captionPending(group.id, 1);
    console.log(
      `  read ${run.described} (${run.fromCache} cached) · ${usd(run.costUsd)} · ${run.remaining} left`,
    );
    if (run.stoppedBecause) console.log(`  stopped: ${run.stoppedBecause}`);
    const entry = await db.query.binEntry.findFirst({
      where: (e, { and, eq, isNotNull }) =>
        and(eq(e.groupId, group.id), isNotNull(e.aiItems)),
      orderBy: (e, { desc }) => [desc(e.effectiveTime)],
    });
    if (entry?.aiItems)
      console.log(`  box #${entry.binId}: ${entry.aiItems.join(", ")}`);
  }
}

const after = aiStatus();
console.log(
  `\ntotal this run: ${usd(after.spentUsd - status.spentUsd)} · month to date ${usd(after.spentUsd)}`,
);
process.exit(ok ? 0 : 1);
