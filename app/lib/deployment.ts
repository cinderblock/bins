/**
 * Deployment-level configuration, as advertised by the server.
 *
 * `/api/landing` is the only endpoint reachable without a token, so it is
 * where flags the SPA needs BEFORE anyone has joined have to live. The value
 * is mirrored into the replica so authenticated pages — and offline boots —
 * can read it without a round trip.
 *
 * These are deploy-time properties (see api/config.ts), not group settings:
 * they change when the operator reconfigures the host, which for a running
 * install is approximately never.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { db, getMeta, setMeta } from "./db";

export const DEPLOYMENT_KEY = "deployment";

/** Which surface `/` renders — see api/config.ts for the reasoning. */
export type HomeView = "scanner" | "browse";

export type Deployment = {
  /** Perimeter-protected: joining needs only a name, stickers carry no code. */
  openAccess: boolean;
  homeView: HomeView;
};

/**
 * What to assume before the server has ever answered: closed (the safe
 * direction for access) and scanner-home (the historical behavior).
 */
export const DEFAULT_DEPLOYMENT: Deployment = {
  openAccess: false,
  homeView: "scanner",
};

export type LandingResponse = {
  needsSetup?: boolean;
  openAccess?: boolean;
  homeView?: string;
  title?: string;
  subtitle?: string;
};

/**
 * Fetch the landing payload and cache the deployment flags from it. Returns
 * the raw body so callers that also want branding don't need a second
 * request. A failure leaves the cached value untouched — a flaky network must
 * not silently flip the app into a different mode.
 */
export async function refreshDeployment(): Promise<LandingResponse | null> {
  try {
    const response = await fetch("/api/landing");
    if (!response.ok) return null;
    const body = (await response.json()) as LandingResponse;
    await setMeta(DEPLOYMENT_KEY, {
      openAccess: body.openAccess === true,
      homeView: body.homeView === "browse" ? "browse" : "scanner",
    } satisfies Deployment);
    return body;
  } catch {
    return null;
  }
}

export async function getDeployment(): Promise<Deployment> {
  return (await getMeta<Deployment>(DEPLOYMENT_KEY)) ?? DEFAULT_DEPLOYMENT;
}

/** Cached deployment config. `undefined` while Dexie is still loading. */
export function useDeployment(): Deployment | undefined {
  return useLiveQuery(
    async () =>
      ((await db.meta.get(DEPLOYMENT_KEY))?.value as Deployment | undefined) ??
      DEFAULT_DEPLOYMENT,
    [],
    undefined,
  );
}
