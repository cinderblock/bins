/**
 * App shell: first-run gate (no identity → onboarding) + boots the sync
 * engine and geo beacon once identity exists. No global chrome — the scanner
 * and bin pages own their full-screen layouts.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { FirstRun } from "~/components/FirstRun";
import { IDENTITY_KEY, type Identity, db } from "~/lib/db";
import { binIdFromScan } from "~/lib/format";
import { startGeo } from "~/lib/geo";
import { startSync } from "~/lib/sync";

export default function Shell() {
  const location = useLocation();
  // undefined = still loading, null = no identity yet.
  const identity = useLiveQuery(
    async () => ((await db.meta.get(IDENTITY_KEY))?.value as Identity) ?? null,
    [],
    undefined,
  );

  useEffect(() => {
    if (identity) {
      startSync();
      void startGeo();
    }
  }, [identity]);

  if (identity === undefined) return null;
  if (identity === null) {
    // Landing unauthenticated on a sticker URL (`/{id}?{CODE}`) is the primary
    // onboarding path: the (id, code) pair joins with just a name. Reuse the
    // QR parser on the current location (any origin works — it's discarded).
    const target = binIdFromScan(
      `https://local${location.pathname}${location.search}`,
    );
    const sticker =
      target?.code != null ? { binId: target.binId, code: target.code } : null;
    return <FirstRun sticker={sticker} />;
  }
  return <Outlet />;
}
