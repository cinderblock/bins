/**
 * Suggested edits — the read side. Members propose changes to a box's identity
 * fields (name / size / external label) and an admin decides; see
 * shared/ops.ts `bin.suggest` for why only those fields.
 *
 * Everything a MEMBER needs comes from the local replica (suggestions ride
 * normal sync), so a pending badge works offline. Only the admin's verdict
 * needs the server, because it needs the admin password.
 */
import type { SuggestFields } from "@shared/ops";
import type { SuggestionState } from "@shared/reducer";
import { useLiveQuery } from "dexie-react-hooks";
import { apiJson } from "./api";
import { db } from "./db";
import { syncNow } from "./sync";

/** Field labels, in the order the UI should show them. */
export const SUGGEST_FIELDS = [
  { key: "name", label: "Name" },
  { key: "sizeClass", label: "Size" },
  { key: "externalLabel", label: "External label" },
] as const satisfies readonly { key: keyof SuggestFields; label: string }[];

/** Pending suggestions for one box, oldest first. Live over the replica. */
export function usePendingSuggestions(binId: number): SuggestionState[] {
  return useLiveQuery(
    () =>
      db.suggestions
        .where("[binId+status]")
        .equals([binId, "pending"])
        .sortBy("createdAt"),
    [binId],
    [],
  );
}

/** Count of everything awaiting a verdict, for the admin entry point's badge. */
export function usePendingSuggestionCount(): number {
  return (
    useLiveQuery(
      () => db.suggestions.where("status").equals("pending").count(),
      [],
      0,
    ) ?? 0
  );
}

/** One row of the admin review queue, as the server renders it. */
export type SuggestionReview = {
  id: string;
  binId: number;
  deviceId: string | null;
  fields: SuggestFields;
  note: string | null;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
  resolvedAt: number | null;
  /** The box's values right now — the "before" half of the diff. */
  current: {
    id: number;
    name: string | null;
    sizeClass: string | null;
    externalLabel: string | null;
  } | null;
};

export async function fetchSuggestions(
  adminPassword: string,
): Promise<SuggestionReview[]> {
  const body = await apiJson<{ suggestions: SuggestionReview[] }>(
    "/api/admin/suggestions",
    { method: "POST", body: JSON.stringify({ adminPassword }) },
  );
  return body.suggestions;
}

/**
 * Approve or reject. The server authors the verdict op (and, on approve, the
 * field change) — we then sync so this device's replica reflects it without
 * waiting for the next poll.
 */
export async function resolveSuggestion(
  adminPassword: string,
  suggestionId: string,
  accepted: boolean,
): Promise<void> {
  await apiJson("/api/admin/suggestions/resolve", {
    method: "POST",
    body: JSON.stringify({ adminPassword, suggestionId, accepted }),
  });
  await syncNow();
}
