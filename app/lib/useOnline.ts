/**
 * `useOnline` — the browser's connectivity, as React state.
 *
 * This file used to export a small "N unsynced" pill shown on two screens.
 * SyncBanner replaced it: unsynced work means photos and notes living on ONE
 * phone, which is too important for a pill in a corner, and it needs to be
 * visible on every screen rather than two.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { type BackendHealth, getHealth, subscribeHealth } from "./health";

/**
 * Whether the SERVER is reachable — a different question from whether this
 * device has a network, and the one that actually matters for anything that
 * needs the backend. See lib/health.ts.
 */
export function useBackendHealth(): BackendHealth {
  return useSyncExternalStore(subscribeHealth, getHealth, getHealth);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
