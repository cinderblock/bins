/**
 * "Desk mode": this device has no useful camera pointed at boxes.
 *
 * A laptop's camera faces the person, not the shelf, so on a desktop the
 * scanner was already opt-in. But opting out was per-session and the home
 * screen still led with a viewfinder — wrong for the job campers actually do
 * sitting down: look through photos, categorise, verify, and search for
 * "where is the thing".
 *
 * Per device rather than per deployment (HOME_VIEW), because one group has
 * both: phones scanning in a storage unit and laptops sorting afterwards.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { NO_CAMERA_KEY, db, getMeta, setMeta } from "./db";

export async function setDeskMode(on: boolean): Promise<void> {
  if (on) await setMeta(NO_CAMERA_KEY, true);
  else await db.meta.delete(NO_CAMERA_KEY);
}

/** `undefined` while loading — callers must not flash the camera before it resolves. */
export function useDeskMode(): boolean | undefined {
  return useLiveQuery(
    async () => (await getMeta<boolean>(NO_CAMERA_KEY)) ?? false,
    [],
    undefined,
  );
}
