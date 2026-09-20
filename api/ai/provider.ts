/**
 * Provider selection, pricing and the one call everything else makes.
 *
 * The app never names a vendor. It hands `askAi` a layered prompt and a
 * schema; which service answers is an env var. That is not future-proofing
 * for its own sake — the whole feature is optional, and an operator who
 * already holds one of these keys should not be made to open an account with
 * anyone else to use it.
 */
import { anthropicProvider } from "./anthropic";
import { budgetUsd, checkBudget, recordSpend, spentByFeature } from "./budget";
import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";
import {
  type AiAnswer,
  type AiAsk,
  type AiModelInfo,
  type AiProvider,
  AiUnavailableError,
} from "./types";

/**
 * Auto-detection order. Gemini leads because a deployment that prints labels
 * already has that key configured (api/labels/art.ts), so the zero-new-
 * accounts path is the default path.
 */
const PROVIDERS: AiProvider[] = [
  geminiProvider,
  openaiProvider,
  anthropicProvider,
];

function keyFor(provider: AiProvider): string | null {
  return process.env[provider.keyEnv]?.trim() || null;
}

export type AiSelection = {
  provider: AiProvider;
  key: string;
  model: string;
  pricing: AiModelInfo;
};

/**
 * Price a model. A model named by `AI_MODEL` that this table has never heard
 * of still WORKS — a renamed or brand-new model shouldn't break the feature —
 * it just can't be priced, so the env overrides exist for that case and
 * `aiStatus` reports the gap rather than silently billing it at zero.
 */
function pricingFor(provider: AiProvider, model: string): AiModelInfo {
  const known = provider.models.find((m) => m.id === model);
  const input = Number(process.env.AI_INPUT_USD_PER_MTOK?.trim());
  const output = Number(process.env.AI_OUTPUT_USD_PER_MTOK?.trim());
  const base: AiModelInfo = known ?? {
    id: model,
    label: "Custom",
    inputUsd: 0,
    cachedInputUsd: 0,
    cacheWriteUsd: 0,
    outputUsd: 0,
  };
  return {
    ...base,
    ...(Number.isFinite(input) && input >= 0
      ? { inputUsd: input, cachedInputUsd: input / 10, cacheWriteUsd: input }
      : {}),
    ...(Number.isFinite(output) && output >= 0 ? { outputUsd: output } : {}),
  };
}

/** The configured provider, or null when the feature is simply off. */
export function selectProvider(): AiSelection | null {
  const named = process.env.AI_PROVIDER?.trim().toLowerCase();
  const candidates = named
    ? PROVIDERS.filter((p) => p.id === named)
    : PROVIDERS;
  for (const provider of candidates) {
    const key = keyFor(provider);
    if (!key) continue;
    const model = process.env.AI_MODEL?.trim() || provider.defaultModel;
    return { provider, key, model, pricing: pricingFor(provider, model) };
  }
  return null;
}

/** What a client needs to decide whether to offer the feature at all. */
export function aiStatus(): {
  available: boolean;
  provider: string | null;
  model: string | null;
  /** True when the selected model has no known rates — spend can't be policed. */
  unpriced: boolean;
  spentUsd: number;
  spentByFeature: Record<string, number>;
  budgetUsd: number | null;
} {
  const selection = selectProvider();
  const byFeature = spentByFeature();
  return {
    available: selection !== null,
    provider: selection?.provider.id ?? null,
    model: selection?.model ?? null,
    unpriced:
      selection !== null &&
      selection.pricing.inputUsd === 0 &&
      selection.pricing.outputUsd === 0,
    spentUsd: Object.values(byFeature).reduce((sum, n) => sum + n, 0),
    spentByFeature: byFeature,
    budgetUsd: budgetUsd(),
  };
}

/** USD for one call, from the token counts the provider reported. */
export function costOf(pricing: AiModelInfo, usage: AiAnswer["usage"]): number {
  return (
    (usage.inputTokens * pricing.inputUsd +
      usage.cachedInputTokens * pricing.cachedInputUsd +
      usage.cacheWriteTokens * pricing.cacheWriteUsd +
      usage.outputTokens * pricing.outputUsd) /
    1_000_000
  );
}

/**
 * Worst case for a request, used to police the ceiling BEFORE spending.
 *
 * Four characters per token is the usual rough ratio and close enough for a
 * backstop; assuming nothing is cached and the full output allowance is spent
 * keeps the estimate above reality, which is the safe direction.
 */
function estimateUsd(pricing: AiModelInfo, req: AiAsk): number {
  const chars =
    req.layers.reduce((n, layer) => n + layer.text.length, 0) +
    req.question.length;
  return (
    ((chars / 4) * pricing.inputUsd + req.maxOutputTokens * pricing.outputUsd) /
    1_000_000
  );
}

/**
 * Ask the configured model a question, within budget.
 *
 * `feature` is the ledger line item ("ask", "caption"), so one ceiling can be
 * shared without one feature quietly consuming another's headroom.
 */
export async function askAi(
  feature: string,
  req: AiAsk,
): Promise<AiAnswer & { provider: string; costUsd: number }> {
  const selection = selectProvider();
  if (!selection) throw new AiUnavailableError("no AI provider configured");

  checkBudget(estimateUsd(selection.pricing, req));
  const answer = await selection.provider.ask(
    selection.model,
    selection.key,
    req,
  );
  // Recorded AFTER the call, because the cost is not knowable before it. A
  // failed call therefore costs nothing, which is the honest outcome — the
  // pre-flight estimate above is what stops a runaway.
  const costUsd = costOf(selection.pricing, answer.usage);
  recordSpend(feature, costUsd);
  return { ...answer, provider: selection.provider.id, costUsd };
}
