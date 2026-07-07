import { registerSW } from "virtual:pwa-register";
/**
 * Service-worker registration + update prompt. A new build waits until the
 * user opts in — NEVER auto-reload: this app is used mid-capture, and a
 * surprise reload would eat a photo or a half-typed note. The pending ops
 * outbox survives reloads regardless (Dexie), but the in-hand moment doesn't.
 */
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect } from "react";

export function PwaUpdatePrompt() {
  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        notifications.show({
          id: "pwa-update",
          autoClose: false,
          withCloseButton: true,
          message: (
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">A new version is ready.</Text>
              <Button size="xs" onClick={() => void updateSW(true)}>
                Update
              </Button>
            </Group>
          ),
        });
      },
    });
  }, []);
  return null;
}
