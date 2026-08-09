import { registerSW } from "virtual:pwa-register";
/**
 * Service-worker registration, and taking new builds automatically.
 *
 * This used to hold a new build back behind a toast the user had to tap, on
 * the reasoning that a surprise reload could eat a photo mid-capture. The
 * reasoning was half right and the cost was enormous: devices stayed on an old
 * build indefinitely, so shipped fixes never reached anyone. (That "never
 * auto-update" rule was an implementation choice from an early session, not a
 * decision anyone asked for.)
 *
 * Activating a worker and reloading a page are different things, and only the
 * second can interrupt someone. So: activate immediately, then reload at the
 * first moment it's free (see lib/appUpdate). Activation is safe even for a
 * page that keeps running the old chunks, because the server serves build
 * artifacts from previous releases too.
 *
 * The toast stays, but only as an offer to take it right now.
 */
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect } from "react";
import { reloadWhenSafe } from "~/lib/appUpdate";

export function PwaUpdatePrompt() {
  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        // `false`: skip waiting, but don't let the helper reload for us — the
        // whole point is that WE choose the moment.
        void updateSW(false);
        reloadWhenSafe();
        notifications.show({
          id: "pwa-update",
          autoClose: false,
          withCloseButton: true,
          message: (
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">
                A new version is ready. It’ll apply on its own in a moment.
              </Text>
              <Button size="xs" onClick={() => window.location.reload()}>
                Reload now
              </Button>
            </Group>
          ),
        });
      },
    });
  }, []);
  return null;
}
