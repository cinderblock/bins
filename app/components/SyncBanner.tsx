/**
 * A banner across the top whenever this device is holding work the server
 * hasn't got.
 *
 * The old signal was a small "N unsynced" pill, and only on two screens. That
 * is far too quiet for what it means: photos and notes living on ONE phone.
 * Everything here is offline-first by design, so unsynced is a normal state —
 * but it is a normal state you must be able to see, because the failure mode
 * is someone closing a browser, losing a phone, or wiping site data with the
 * only copy of an afternoon's work on it.
 *
 * Only shows when there is something to say — pending work, or a dead token.
 * A plain "offline" banner would be permanent noise in a storage unit, which
 * is exactly where this app is supposed to feel normal.
 *
 * It publishes its height as `--bins-banner-h` so everything anchored to the
 * top of the screen moves down instead of hiding behind it.
 */
import { Box, Button, Group, Text } from "@mantine/core";
import { IconCloudOff, IconCloudUpload, IconLock } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { AUTH_DEAD_KEY, db } from "~/lib/db";
import { syncNow } from "~/lib/sync";
import { useOnline } from "~/lib/useOnline";

/** Above page chrome, below Mantine's modals (200) and notifications (400). */
const BANNER_Z = 150;

export function SyncBanner() {
  const navigate = useNavigate();
  const online = useOnline();
  const ref = useRef<HTMLDivElement>(null);

  const pendingOps = useLiveQuery(async () => db.pendingOps.count(), [], 0);
  const pendingPhotos = useLiveQuery(
    async () => db.blobs.where("status").equals("pending").count(),
    [],
    0,
  );
  const authDead = useLiveQuery(
    async () => (await db.meta.get(AUTH_DEAD_KEY))?.value === true,
    [],
    false,
  );

  const pending = pendingOps + pendingPhotos;
  const show = authDead || pending > 0;

  // Publish the height so top-anchored layouts can clear it. Cleared when
  // hidden so nothing keeps a phantom gap.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!show || !ref.current) {
      root.style.removeProperty("--bins-banner-h");
      return;
    }
    const set = () =>
      root.style.setProperty(
        "--bins-banner-h",
        `${ref.current?.offsetHeight ?? 0}px`,
      );
    set();
    const observer = new ResizeObserver(set);
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bins-banner-h");
    };
  }, [show]);

  if (!show) return null;

  // A dead token is the one case retrying can't fix, so it outranks the rest.
  const kind = authDead ? "signedOut" : online ? "syncing" : "offline";
  const { color, icon, message } = {
    signedOut: {
      color: "red",
      icon: <IconLock size={16} />,
      message: `Signed out — ${pending} change${pending === 1 ? "" : "s"} can't be saved to the server`,
    },
    offline: {
      color: "orange",
      icon: <IconCloudOff size={16} />,
      message: `Offline — ${pending} change${pending === 1 ? "" : "s"} saved on this device only`,
    },
    syncing: {
      color: "blue",
      icon: <IconCloudUpload size={16} />,
      message: `${pending} change${pending === 1 ? "" : "s"} not yet on the server`,
    },
  }[kind];

  return (
    <Box
      ref={ref}
      bg={`var(--mantine-color-${color}-filled)`}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: BANNER_Z,
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <Group justify="center" gap="xs" wrap="nowrap" px="sm" py={6}>
        {icon}
        <Text size="sm" fw={500} style={{ minWidth: 0 }}>
          {message}
        </Text>
        {kind === "signedOut" ? (
          <Button
            size="compact-xs"
            variant="white"
            onClick={() => navigate("/settings")}
          >
            Fix
          </Button>
        ) : (
          online && (
            <Button
              size="compact-xs"
              variant="white"
              onClick={() => void syncNow()}
            >
              Sync now
            </Button>
          )
        )}
      </Group>
    </Box>
  );
}
