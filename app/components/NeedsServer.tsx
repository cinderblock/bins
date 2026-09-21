/**
 * "This bit needs the server, and the server isn't there."
 *
 * Most of this app works from its replica, which is the point — but some
 * things cannot: allocating a box id (the id sequence is global), printing a
 * label (the printer is on the server's network), drawing artwork, anything
 * admin, anything AI. Offering those normally while the backend is
 * unreachable produces the worst kind of failure: a button that looks live,
 * a spinner, and then nothing, or worse, a success that never happened.
 *
 * So the affordance stays visible but disabled, and says why. Visible rather
 * than hidden on purpose — a control that vanishes teaches people the app is
 * broken in some unspecified way; one that explains itself teaches them the
 * server is down and the work is waiting.
 */
import { Alert, Text } from "@mantine/core";
import { IconPlugConnectedX } from "@tabler/icons-react";
import { relativeTime } from "~/lib/format";
import { useBackendHealth } from "~/lib/useOnline";

/** True when server-only actions should be disabled right now. */
export function useServerDown(): boolean {
  return useBackendHealth().reachable === false;
}

/**
 * An inline explanation for a panel whose contents need the server. Renders
 * nothing when the server is fine, so it can sit unconditionally in a form.
 */
export function NeedsServer({
  /** What can't be done, e.g. "Printing and drawings". */
  what,
}: {
  what: string;
}) {
  const health = useBackendHealth();
  if (health.reachable !== false) return null;
  return (
    <Alert
      color="red"
      variant="light"
      icon={<IconPlugConnectedX size={16} />}
      p="xs"
    >
      <Text size="sm">
        {what} need the server, and it can't be reached
        {health.lastOkAt
          ? ` (last answered ${relativeTime(health.lastOkAt)})`
          : ""}
        . Everything already on this device still works.
      </Text>
    </Alert>
  );
}
