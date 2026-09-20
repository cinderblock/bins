/**
 * Put-away: filing boxes onto shelves by scanning.
 *
 * The job this models is someone standing at a shelf with a trolley of
 * boxes. Asking which shelf for every box would be a prompt per box; instead
 * a shelf is chosen ONCE and sticks until it changes, and from then on every
 * box scanned lands there. The shelf changes by scanning that shelf's own
 * printed sticker, or by tapping one of the recent ones.
 *
 * "Recent" is per DEVICE, not per group: it is a record of where this person
 * has been working in the last while, which is exactly the list worth
 * offering as buttons. It lives in the replica's meta table like the other
 * device-local preferences.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { db, getMeta, setMeta } from "./db";

/** Meta key: place ids this device filed boxes into, most recent first. */
export const RECENT_PLACES_KEY = "recentPlaces";
/** Meta key: the shelf put-away is currently filing into, across visits. */
export const PUTAWAY_PLACE_KEY = "putawayPlace";

/**
 * Enough to cover a working session's worth of shelves without the row of
 * buttons turning into its own scrolling problem.
 */
const MAX_RECENT = 8;

export async function rememberRecentPlace(placeId: string): Promise<void> {
  const current = (await getMeta<string[]>(RECENT_PLACES_KEY)) ?? [];
  const next = [placeId, ...current.filter((id) => id !== placeId)].slice(
    0,
    MAX_RECENT,
  );
  await setMeta(RECENT_PLACES_KEY, next);
}

/** Recent place ids, most recent first. Ids only — names come from the replica. */
export function useRecentPlaceIds(): string[] {
  return useLiveQuery(
    async () => (await getMeta<string[]>(RECENT_PLACES_KEY)) ?? [],
    [],
    [],
  );
}

/** The shelf put-away is filing into; null when none is chosen yet. */
export function usePutawayPlaceId(): string | null | undefined {
  return useLiveQuery(
    async () => (await db.meta.get(PUTAWAY_PLACE_KEY))?.value ?? null,
    [],
    undefined,
  ) as string | null | undefined;
}

export async function setPutawayPlace(placeId: string | null): Promise<void> {
  await setMeta(PUTAWAY_PLACE_KEY, placeId);
  if (placeId) await rememberRecentPlace(placeId);
}
