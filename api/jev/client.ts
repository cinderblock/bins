/**
 * Talking to Jev.
 *
 * One call, several questions: they evaluate in parallel and adding one
 * barely moves the latency, so anything decided about the same state should
 * ride the same request rather than a second round trip.
 *
 * Measured on this app's own queries (2026-09-21, jev-1.13.0): about 130ms
 * per call and 400 input tokens, which at $0.042 per million is small enough
 * that the ceiling below will never be what stops it. The ceiling is shared
 * with api/ai so one number still covers everything that spends.
 */
import { checkBudget, recordSpend } from "../ai/budget";
import {
  JevError,
  type JevQuestion,
  type JevResponse,
  JevUnavailableError,
  jevResponseSchema,
} from "./types";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** USD per million input tokens. Output tokens are free on this model. */
const INPUT_USD_PER_MTOK = 0.042;

/** Named for the vendor, matching their SDK and the rest of api/ai. */
export function jevApiKey(): string | null {
  return process.env.TYPESAFE_AI_API_KEY?.trim() || null;
}

export function jevAvailable(): boolean {
  return jevApiKey() !== null;
}

/** `jev-latest` tracks the stable release; the response says what really ran. */
export function jevModel(): string {
  return process.env.JEV_MODEL?.trim() || "jev-latest";
}

/**
 * How sure Jev has to be before its answer is acted on.
 *
 * Not a guess: on this app's own routing cases the answers that were correct
 * and stable across runs all scored 0.65 or better, while the one genuinely
 * ambiguous phrase ("new box of drill bits" — find it, or put it away?)
 * scored 0.05-0.07 and flipped between runs. Nothing landed in between, so
 * the threshold sits in the gap. Below it, callers fall back to asking the
 * person rather than guessing on their behalf.
 */
export const JEV_MIN_CONFIDENCE = 0.4;

export type JevResult = JevResponse & { costUsd: number };

/** Transient by the vendor's own documentation; everything else is final. */
const RETRYABLE = new Set([429, 529]);

/**
 * Ask Jev about one state.
 *
 * `feature` is the ledger line item, so the itemised spend in /admin keeps
 * saying where the money went even as the list of things using this grows.
 */
export async function askJev(
  feature: string,
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResult> {
  const key = jevApiKey();
  if (!key) throw new JevUnavailableError("no TypeSafe AI key configured");

  // Worst case for the ceiling: the whole state billed as input. Four
  // characters per token is the usual rough ratio and errs high, which is the
  // safe direction for a backstop.
  const size =
    typeof state === "string" ? state.length : JSON.stringify(state).length;
  checkBudget(((size / 4) * INPUT_USD_PER_MTOK) / 1_000_000);

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0)
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, model: jevModel(), questions }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      lastError = err;
      continue;
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      lastError = new JevError(`jev returned ${response.status}: ${detail}`);
      if (RETRYABLE.has(response.status)) continue;
      throw lastError;
    }

    const body = await response.json().catch(() => null);
    const parsed = jevResponseSchema.safeParse(body);
    if (!parsed.success) {
      // Typed at the source or not, an unexpected shape here would silently
      // disable the confidence threshold rather than fail loudly.
      throw new JevError(
        `jev returned an unexpected shape: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    const costUsd =
      ((parsed.data.usage?.input_tokens ?? 0) * INPUT_USD_PER_MTOK) / 1_000_000;
    recordSpend(feature, costUsd);
    return { ...parsed.data, costUsd };
  }
  throw lastError instanceof Error
    ? lastError
    : new JevError("jev could not be reached");
}

export function jevStatus(): {
  available: boolean;
  model: string | null;
  minConfidence: number;
} {
  return {
    available: jevAvailable(),
    model: jevAvailable() ? jevModel() : null,
    minConfidence: JEV_MIN_CONFIDENCE,
  };
}
