/**
 * App shell: first-run gate (no identity → onboarding) + boots the sync
 * engine and geo beacon once identity exists. No global chrome — the scanner
 * and bin pages own their full-screen layouts.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { FirstRun } from "~/components/FirstRun";
import { InstallHint } from "~/components/InstallHint";
import { Landing } from "~/components/Landing";
import { IDENTITY_KEY, type Identity, db } from "~/lib/db";
import { refreshDeployment, useDeployment } from "~/lib/deployment";
import { binIdFromScan } from "~/lib/format";
import { startGeo } from "~/lib/geo";
// Imported for its side effect too: captures `beforeinstallprompt` early.
import "~/lib/install";
import { startSync } from "~/lib/sync";

export default function Shell() {
  const location = useLocation();
  // undefined = still loading, null = no identity yet.
  const identity = useLiveQuery(
    async () => ((await db.meta.get(IDENTITY_KEY))?.value as Identity) ?? null,
    [],
    undefined,
  );
  const deployment = useDeployment();

  useEffect(() => {
    if (identity) {
      startSync();
      void startGeo();
    }
  }, [identity]);

  // Refresh the deploy-time flags whenever we're signed out: they decide
  // which gate renders below, and a device that joined before the operator
  // changed the trust model would otherwise keep the stale one.
  useEffect(() => {
    if (identity === null) void refreshDeployment();
  }, [identity]);

  if (identity === undefined || deployment === undefined) return null;
  if (identity === null) {
    // Landing unauthenticated on a sticker URL (`/{id}#{CODE}`) is the primary
    // (and only advertised) way in: the (id, code) pair joins with just a
    // name. Reuse the QR parser on the current location (any origin works —
    // it's discarded).
    const target = binIdFromScan(
      `https://local${location.pathname}${location.search}${location.hash}`,
    );
    if (target?.code != null) {
      return <FirstRun sticker={{ binId: target.binId, code: target.code }} />;
    }
    // The two unauthenticated routes handle themselves: the unlinked /join
    // (access-code bootstrap/fallback) and first-boot /setup.
    if (location.pathname === "/join" || location.pathname === "/setup") {
      return <Outlet />;
    }
    // Perimeter-protected deployment: reaching the app at all is the proof of
    // access, so ask for a name instead of showing a dead-end landing page.
    if (deployment.openAccess) return <FirstRun sticker={null} />;
    // Everything else: branded landing — no entry form, scan a box to start.
    return <Landing />;
  }
  return (
    <>
      <InstallHint />
      <Outlet />
    </>
  );
}
