/**
 * deviceId → displayName, for attributing entries to people. The group's map
 * is cached in meta by the sync engine; the local identity is merged over it
 * so your own ops are labelled even before the first devices fetch lands.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

export function useAuthors(): Record<string, string> {
  return useLiveQuery(
    async () => {
      const devices = (await db.meta.get("devices"))?.value as
        | Record<string, string>
        | undefined;
      const identity = (await db.meta.get("identity"))?.value as
        | { deviceId: string; displayName: string }
        | undefined;
      return {
        ...devices,
        ...(identity ? { [identity.deviceId]: identity.displayName } : {}),
      };
    },
    [],
    {} as Record<string, string>,
  );
}
