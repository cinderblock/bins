/**
 * A banner across the top whenever this device is not in the state it looks
 * like it is in.
 *
 * Two different problems, and the difference matters:
 *
 * - **The server is unreachable.** Shown WHENEVER it is, with or without
 *   pending work, because this is the one the app is worst at admitting. A
 *   replica renders boxes, photos and shelves perfectly while the backend is
 *   face down, so the app looks entirely healthy while half of what it offers
 *   — printing, new boxes, anything admin — cannot possibly work. On
 *   2026-09-21 the warehouse instance crash-looped behind a proxy returning
 *   502 and the app said nothing at all.
 * - **Unsynced work.** Photos and notes living on ONE phone. Everything here
 *   is offline-first by design, so unsynced is a normal state — but a normal
 *   state you must be able to see, because the failure mode is someone
 *   closing a browser, losing a phone, or wiping site data with the only copy
 *   of an afternoon's work on it.
 *
 * It publishes its height as `--bins-banner-h` so everything anchored to the
 * top of the screen moves down instead of hiding behind it.
 */
import { Box, Button, Group, Text } from "@mantine/core";
import {
  IconCloudOff,
  IconCloudUpload,
  IconLock,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { AUTH_DEAD_KEY, db } from "~/lib/db";
import { relativeTime } from "~/lib/format";
import { probeBackend } from "~/lib/health";
import { syncNow } from "~/lib/sync";
import { useBackendHealth, useOnline } from "~/lib/useOnline";

/** Above page chrome, below Mantine's modals (200) and notifications (400). */
const BANNER_Z = 150;

export function SyncBanner() {
  const navigate = useNavigate();
  const online = useOnline();
  const health = useBackendHealth();
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
  const unreachable = health.reachable === false;
  const show = unreachable || authDead || pending > 0;

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

  // Order is deliberate. A server nobody can reach outranks everything: it
  // explains the dead token and the growing pile at once, and it is the only
  // one that says "what you are looking at may be stale".
  const kind = unreachable
    ? "unreachable"
    : authDead
      ? "signedOut"
      : online
        ? "syncing"
        : "offline";

  const changes = `${pending} change${pending === 1 ? "" : "s"}`;
  const { color, icon, message } = {
    unreachable: {
      color: "red",
      icon: <IconPlugConnectedX size={16} />,
      message: online
        ? `Can't reach the server${
            health.lastOkAt
              ? ` — last answered ${relativeTime(health.lastOkAt)}`
              : ""
          }. What you see may be out of date${
            pending > 0 ? `, and ${changes} can't be saved` : ""
          }.`
        : `This device is offline. What you see may be out of date${
            pending > 0 ? `, and ${changes} can't be saved` : ""
          }.`,
    },
    signedOut: {
      color: "red",
      icon: <IconLock size={16} />,
      message: `Signed out — ${changes} can't be saved to the server`,
    },
    offline: {
      color: "orange",
      icon: <IconCloudOff size={16} />,
      message: `Offline — ${changes} saved on this device only`,
    },
    syncing: {
      color: "blue",
      icon: <IconCloudUpload size={16} />,
      message: `${changes} not yet on the server`,
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
        {kind === "unreachable" ? (
          <Button
            size="compact-xs"
            variant="white"
            loading={health.probing}
            onClick={() => {
              // A successful probe means queued work can flow again.
              void probeBackend().then(async (ok) => {
                if (ok) await syncNow();
              });
            }}
          >
            Retry
          </Button>
        ) : kind === "signedOut" ? (
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
