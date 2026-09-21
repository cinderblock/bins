/**
 * Client side of the AI assistant (api/ai/*).
 *
 * Server-only by design: the assistant needs the whole catalog and a provider
 * key, neither of which belongs on a phone. That makes it the one surface in
 * this app that does NOT work offline — so everything here is an enhancement
 * layered over the MiniSearch browse in routes/bins.tsx, which always works.
 * If this fails, the box list is still right there.
 */
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "./api";

/**
 * "auto" asks the server to work out which question was meant. It may come
 * back `ambiguous`, which is not a failure — it is the honest answer, and the
 * UI puts the choice back to the person.
 */
export type AskKind = "place" | "find" | "auto";

export type AskedBox = {
  id: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  /** Resolved server-side from the box row — never from the model. */
  name: string | null;
  location: string | null;
  handle: string | null;
  description: string | null;
  fillLevel: number | null;
  size: string | null;
};

export type AskAnswer = {
  /** True when nothing was asked of the expensive model: say which you meant. */
  ambiguous?: boolean;
  /** Which question actually got answered — set unless `ambiguous`. */
  kind?: Exclude<AskKind, "auto">;
  answer: string;
  boxes: AskedBox[];
  newBox: boolean;
  newBoxReason: string;
  suggestedPlace: string;
  meta: {
    provider: string;
    model: string;
    costUsd: number;
    bins: number;
    tailOps: number;
    cachedInputTokens: number;
    /** Set when the classifier picked the question rather than the person. */
    routedConfidence: number | null;
    /** How many boxes the prompt carried, when a shortlist narrowed it. */
    narrowedTo: number | null;
    /** Probability an existing box fits, on a placement question. */
    fitProbability: number | null;
  };
};

export type AiStatus = {
  available: boolean;
  /** The classifier that routes the question; absent on older servers. */
  jev?: { available: boolean; model: string | null; minConfidence: number };
  provider: string | null;
  model: string | null;
  unpriced: boolean;
  spentUsd: number;
  spentByFeature: Record<string, number>;
  budgetUsd: number | null;
};

export async function fetchAiStatus(): Promise<AiStatus | null> {
  try {
    const res = await apiFetch("/api/ai/status");
    return (await res.json()) as AiStatus;
  } catch {
    // Offline, or an older server without the route. Either way the answer
    // is the same: don't offer the feature.
    return null;
  }
}

export async function ask(
  kind: AskKind,
  query: string,
  adminPassword?: string | null,
): Promise<AskAnswer> {
  const res = await apiFetch("/api/ai/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // adminPassword only matters on deployments running AI_ASSIST_ADMIN_ONLY;
    // elsewhere the server ignores it.
    body: JSON.stringify({ kind, query, adminPassword: adminPassword ?? "" }),
  });
  return (await res.json()) as AskAnswer;
}

/**
 * Whether to offer the feature at all.
 *
 * Checked once per mount rather than cached globally: an operator who has
 * just set a key should see the buttons on the next page load, not after
 * clearing site data.
 */
export function useAiAvailable(): boolean {
  return useAssistant().available;
}

/**
 * What the assistant can do here: whether it answers at all, and whether the
 * classifier is available to route so the search box needs one button rather
 * than two.
 */
export function useAssistant(): { available: boolean; routes: boolean } {
  const [state, setState] = useState({ available: false, routes: false });
  useEffect(() => {
    let live = true;
    fetchAiStatus().then((status) => {
      if (!live) return;
      setState({
        available: status?.available === true,
        routes: status?.available === true && status.jev?.available === true,
      });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** Turn a failure into something worth reading on a phone. */
export function askErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402)
      return "This month's AI budget is used up. Ask an admin to raise it.";
    if (err.status === 429)
      return "That's a lot of questions in one hour — try again later.";
    if (err.status === 503) return "AI assistance isn't set up on this server.";
    if (err.status === 502)
      return "The AI provider didn't answer. Try again in a moment.";
    return err.message;
  }
  return "Couldn't reach the server. The box list below still works.";
}
