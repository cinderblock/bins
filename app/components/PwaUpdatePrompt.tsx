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

/**
 * How often to ask the browser to re-check the worker script. The browser
 * does this on its own only at launch and roughly daily, so a tab left open
 * (or an installed app never fully closed) would run an old build for hours
 * after a deploy. Fifteen minutes is prompt without being chatty: the check
 * is one conditional request for a small script.
 */
const UPDATE_CHECK_MS = 15 * 60_000;

export function PwaUpdatePrompt() {
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const updateSW = registerSW({
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        const check = () => {
          // A failed check (offline, server mid-deploy) is not an error worth
          // anything; the next one will do.
          void registration.update().catch(() => {});
        };
        const timer = window.setInterval(check, UPDATE_CHECK_MS);
        // Coming back to the app is the natural moment to catch up — and the
        // one where a deploy that happened meanwhile is most likely.
        const onVisible = () => {
          if (document.visibilityState === "visible") check();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", check);
        cleanups.push(() => {
          window.clearInterval(timer);
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("online", check);
        });
      },
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
    return () => {
      for (const c of cleanups) c();
    };
  }, []);
  return null;
}
