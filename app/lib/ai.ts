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

export type AskKind = "place" | "find";

export type AskedBox = {
  id: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  /** Resolved server-side from the box row — never from the model. */
  name: string | null;
  location: string | null;
  handle: string | null;
};

export type AskAnswer = {
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
  };
};

export type AiStatus = {
  available: boolean;
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
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    fetchAiStatus().then((status) => {
      if (live) setAvailable(status?.available === true);
    });
    return () => {
      live = false;
    };
  }, []);
  return available;
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
