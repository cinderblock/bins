/**
 * One-time "add it to your home screen" nudge, shown shortly after boot in a
 * browser tab (never when already installed). Android gets the native prompt
 * button; iOS gets pointed at the instructions in settings.
 */
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { INSTALL_HINT_KEY, getMeta, setMeta } from "~/lib/db";
import { canPromptInstall, isStandalone, promptInstall } from "~/lib/install";

export function InstallHint() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled || isStandalone()) return;
        if (await getMeta<boolean>(INSTALL_HINT_KEY)) return;
        await setMeta(INSTALL_HINT_KEY, true);
        notifications.show({
          id: "install-hint",
          autoClose: 15_000,
          message: (
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">
                Tip: install bins on your home screen — it starts offline and
                keeps unsynced photos safer.
              </Text>
              <Button
                size="xs"
                onClick={() => {
                  notifications.hide("install-hint");
                  if (canPromptInstall()) void promptInstall();
                  else navigate("/settings");
                }}
              >
                {canPromptInstall() ? "Install" : "How"}
              </Button>
            </Group>
          ),
        });
      })();
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [navigate]);

  return null;
}
