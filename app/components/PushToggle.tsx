/**
 * "Tell me when someone suggests an edit" — the admin-page switch for web
 * push. Only rendered where the deployment has VAPID keys configured; the
 * states it can be in are all reachable in practice, so each one says what to
 * do rather than just being disabled:
 *
 * - not configured  → the card isn't rendered at all (nothing to say)
 * - needs-install   → iOS only allows push inside an installed PWA
 * - denied          → the browser will not re-prompt; only settings can undo it
 * - unsupported     → no push here, say so plainly
 */
import { Alert, Paper, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBell } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useDeployment } from "~/lib/deployment";
import {
  pushAvailability,
  pushSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from "~/lib/push";

export function PushToggle({ adminPassword }: { adminPassword: string }) {
  const deployment = useDeployment();
  const publicKey = deployment?.pushPublicKey ?? null;
  const availability = pushAvailability(publicKey);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(
    typeof Notification === "undefined" ? null : Notification.permission,
  );

  useEffect(() => {
    if (availability.kind !== "ready") return;
    void pushSubscribed().then(setOn);
  }, [availability.kind]);

  if (availability.kind === "not-configured") return null;

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        if (!publicKey) return;
        const granted = await subscribeToPush(adminPassword, publicKey);
        setPermission(Notification.permission);
        if (!granted) {
          notifications.show({
            message: "Notifications are blocked for this site",
            color: "yellow",
          });
          return;
        }
        setOn(true);
        notifications.show({ message: "Notifications on", color: "green" });
      } else {
        await unsubscribeFromPush();
        setOn(false);
        notifications.show({ message: "Notifications off", color: "gray" });
      }
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="xs">
        <Text fw={600}>Notifications</Text>
        <Text size="xs" c="dimmed">
          Get a notification on this device when someone suggests a change to a
          box. Nothing else notifies — photos, notes and locations apply
          themselves, so there is nothing to approve.
        </Text>

        {availability.kind === "needs-install" && (
          <Alert variant="light" color="blue" icon={<IconBell size={18} />}>
            <Text size="sm">
              Add bins to your home screen first — this device only allows
              notifications for an installed app.
            </Text>
          </Alert>
        )}

        {availability.kind === "unsupported" && (
          <Text size="sm" c="dimmed">
            This browser can't do notifications.
          </Text>
        )}

        {availability.kind === "ready" && (
          <>
            <Switch
              checked={on}
              disabled={busy || permission === "denied"}
              onChange={(e) => void toggle(e.currentTarget.checked)}
              label="Tell me about suggested edits"
            />
            {permission === "denied" && (
              <Text size="xs" c="dimmed">
                Notifications are blocked for this site in your browser settings
                — the app can't ask again until you unblock them there.
              </Text>
            )}
            <Text size="xs" c="dimmed">
              Only devices that have unlocked admin can turn this on, and it
              only ever notifies this one device.
            </Text>
          </>
        )}
      </Stack>
    </Paper>
  );
}
