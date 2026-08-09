/**
 * Detect an app that booted but can no longer load the rest of itself, and
 * offer the one-tap repair.
 *
 * The shape of the failure: an installed service worker serves the shell it
 * precached, that shell boots fine off chunks already in the HTTP cache, and
 * then the first navigation to a route the device hasn't visited asks for a
 * chunk the release tree no longer has. The import rejects and the tap simply
 * does nothing — reported from the field as "/admin doesn't do anything" and
 * "'I have an access code' isn't a button". Nothing is visibly broken, which
 * is the worst part.
 *
 * A failed dynamic import IS the signal, so no guessing and no banner on a
 * healthy app: Vite fires `vite:preloadError`, and a module that fails outside
 * the preload path surfaces as an unhandled rejection whose message says so.
 */
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect } from "react";

export const RECOVER_URL = "/api/recover";

const NOTIFICATION_ID = "stale-build";

/** Does this rejection look like a chunk that no longer exists? */
function isModuleLoadFailure(reason: unknown): boolean {
  const message =
    reason instanceof Error ? reason.message : String(reason ?? "");
  return (
    /dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message)
  );
}

function showRepairPrompt() {
  notifications.show({
    id: NOTIFICATION_ID,
    autoClose: false,
    withCloseButton: true,
    color: "yellow",
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">
          This app is out of date and can’t open that page. Repairing takes a
          second and won’t lose anything.
        </Text>
        <Button
          size="xs"
          onClick={() => {
            window.location.href = RECOVER_URL;
          }}
        >
          Repair
        </Button>
      </Group>
    ),
  });
}

export function StaleBuildBanner() {
  useEffect(() => {
    const onPreloadError = () => showRepairPrompt();
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isModuleLoadFailure(event.reason)) showRepairPrompt();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
