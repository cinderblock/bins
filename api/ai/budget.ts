/**
 * Spend ledger for every AI feature.
 *
 * A JSON file rather than a table, for the same reasons the label-art ledger
 * is one (api/labels/art.ts): it needs no migration, no sync and no history —
 * the only question is how much has been spent this month. Keyed by month so
 * the window rolls with no cleanup job.
 *
 * Deliberately a SEPARATE file from the art ledger. The two budgets are
 * independent on purpose: a captioning backfill must not be able to drain the
 * budget the label printer depends on, and vice versa.
 *
 * Within this file, spend is recorded per feature so `ai/status` can show
 * where the money went — one ceiling, itemised.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AiBudgetError } from "./types";

/** month -> feature -> USD. */
type Ledger = Record<string, Record<string, number>>;

function ledgerPath(): string {
  const base =
    process.env.AI_SPEND_PATH?.trim() ||
    join(process.env.PHOTOS_PATH?.trim() || "./data/photos", "..", "ai");
  return join(base, "spend.json");
}

/** Monthly ceiling in USD. Unset = no ceiling (deliberate, not a default). */
export function budgetUsd(): number | null {
  const raw = process.env.AI_BUDGET_USD?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(ledgerPath(), "utf8")) as Ledger;
  } catch {
    return {};
  }
}

/** `YYYY-MM`, UTC. */
function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function spentByFeature(): Record<string, number> {
  return readLedger()[monthKey()] ?? {};
}

export function spentThisMonth(): number {
  return Object.values(spentByFeature()).reduce((sum, n) => sum + n, 0);
}

export function recordSpend(feature: string, usd: number): void {
  if (!(usd > 0)) return;
  const ledger = readLedger();
  const key = monthKey();
  const month = ledger[key] ?? {};
  month[feature] = Math.max(0, (month[feature] ?? 0) + usd);
  ledger[key] = month;
  mkdirSync(dirname(ledgerPath()), { recursive: true });
  writeFileSync(ledgerPath(), JSON.stringify(ledger));
}

/**
 * Refuse a call whose worst case would break the ceiling.
 *
 * Token-priced calls cannot be charged up front the way a fixed-price image
 * can, so `estimateUsd` is deliberately a WORST case — every input token at
 * the uncached rate, every permitted output token spent. Real calls come in
 * under it, which is the right direction for a safety ceiling to be wrong in.
 *
 * Concurrent requests can still collectively overshoot, since each is checked
 * against the same pre-call total. That is accepted: this is a runaway-spend
 * backstop, not an accounting system, and the overshoot is bounded by however
 * many requests are genuinely in flight at once.
 */
export function checkBudget(estimateUsd: number): void {
  const budget = budgetUsd();
  if (budget === null) return;
  const spent = spentThisMonth();
  if (spent + estimateUsd > budget) {
    throw new AiBudgetError(
      `monthly AI budget of $${budget.toFixed(2)} would be exceeded (spent $${spent.toFixed(2)})`,
    );
  }
}
