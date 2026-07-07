/**
 * "N unsynced" pill — pending ops + photos still waiting for the server, plus
 * an offline dot. Tap → settings (sync details live there).
 */
import { Badge } from "@mantine/core";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AUTH_DEAD_KEY, db } from "~/lib/db";

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

export function SyncBadge() {
  const online = useOnline();
  const pending = useLiveQuery(
    async () =>
      (await db.pendingOps.count()) +
      (await db.blobs.where("status").equals("pending").count()),
    [],
    0,
  );
  const authDead = useLiveQuery(
    async () => (await db.meta.get(AUTH_DEAD_KEY))?.value === true,
    [],
    false,
  );

  if (authDead) {
    // Retrying can't fix a dead token — point at settings' sign-back-in.
    return (
      <Badge
        component={Link}
        to="/settings"
        color="red"
        variant="filled"
        style={{ cursor: "pointer" }}
      >
        signed out{pending ? ` · ${pending}` : ""}
      </Badge>
    );
  }

  if (online && pending === 0) return null;
  return (
    <Badge
      component={Link}
      to="/settings"
      color={online ? "yellow" : "red"}
      variant="filled"
      style={{ cursor: "pointer" }}
    >
      {online
        ? `${pending} unsynced`
        : `offline${pending ? ` · ${pending}` : ""}`}
    </Badge>
  );
}
