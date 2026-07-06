/**
 * Passive last-known-fix beacon. While the app is visible (and the user opted
 * in at first-run), a low-power watchPosition keeps a cached fix; ops copy it
 * synchronously — the fast flow NEVER waits on GPS. Stale (>2 min) or absent
 * fix → ops record no geo.
 */
import type { Geo } from "@shared/ops";
import { getMeta, setMeta } from "./db";

export const GEO_OPT_IN_KEY = "geoOptIn";
const MAX_FIX_AGE_MS = 2 * 60_000;

let lastFix: (Geo & { at: number }) | null = null;
let watchId: number | null = null;

function startWatch() {
  if (watchId !== null || !("geolocation" in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastFix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy,
        at: Date.now(),
      };
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 30_000 },
  );
}

function stopWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/** Called from the shell once identity exists. */
export async function startGeo(): Promise<void> {
  if (!(await getMeta<boolean>(GEO_OPT_IN_KEY))) return;
  startWatch();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") startWatch();
    else stopWatch();
  });
}

export async function setGeoOptIn(optIn: boolean): Promise<void> {
  await setMeta(GEO_OPT_IN_KEY, optIn);
  if (optIn) startWatch();
  else stopWatch();
}

/** The cached fix, if fresh enough — synchronous by design. */
export function currentGeo(): Geo | null {
  if (!lastFix || Date.now() - lastFix.at > MAX_FIX_AGE_MS) return null;
  return { lat: lastFix.lat, lng: lastFix.lng, acc: lastFix.acc };
}
