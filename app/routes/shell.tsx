/**
 * App shell: first-run gate (no identity → onboarding) + boots the sync
 * engine and geo beacon once identity exists. No global chrome — the scanner
 * and bin pages own their full-screen layouts.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { Outlet } from "react-router";
import { FirstRun } from "~/components/FirstRun";
import { IDENTITY_KEY, type Identity, db } from "~/lib/db";
import { startGeo } from "~/lib/geo";
import { startSync } from "~/lib/sync";

export default function Shell() {
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
  if (identity === null) return <FirstRun />;
  return <Outlet />;
}
