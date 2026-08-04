import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { useEffect } from "react";
import type { Route } from "./+types/root";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import { TOAST_BOTTOM } from "./lib/ui";

// Paint the right background on the very first frame (before JS/CSS), so a
// dark-mode phone never flashes white. Dark is the app default — this tool
// lives in dim storage containers and behind camera viewfinders.
const earlyColorSchemeCss = `
:root { color-scheme: dark; }
html { background-color: #242424; }
html[data-mantine-color-scheme="light"] { background-color: #ffffff; color-scheme: light; }
`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>bins</title>
        <meta name="theme-color" content="#242424" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <Meta />
        <Links />
        <ColorSchemeScript defaultColorScheme="dark" />
        <style>{earlyColorSchemeCss}</style>
      </head>
      <body>
        <MantineProvider defaultColorScheme="dark">
          {/* Bottom-center: toasts land in the thumb/glance zone, confirming
              fast-flow actions ("Photo saved") without reaching — but lifted
              clear of the fixed bottom controls they'd otherwise cover. */}
          <Notifications
            position="bottom-center"
            style={{ bottom: TOAST_BOTTOM }}
          />
          <PwaUpdatePrompt />
          {children}
        </MantineProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// Shown while the SPA boots (SPA mode renders this into index.html).
/**
 * How long to wait before deciding the app has failed to boot. Generous: a
 * cold cache on a slow phone over a busy LAN can legitimately take a few
 * seconds, and a false trigger costs a reload.
 */
const BOOT_TIMEOUT_MS = 10_000;
const BOOT_RECOVERY_KEY = "bins:boot-recovery";

export function HydrateFallback() {
  // Self-heal a stale service worker.
  //
  // Every deploy rehashes the assets. An installed SW keeps serving the
  // index.html it precached, that shell asks for chunks which no longer
  // exist, and the app never hydrates — leaving this fallback on screen
  // forever. The update prompt that would replace the SW is a component
  // INSIDE the app, so it never gets to run: the fix is trapped behind the
  // thing it fixes. This is the only code that still runs in that state.
  //
  // Safe to be aggressive here: the caches hold the precached shell and
  // re-fetchable photo bytes. All real data — the replica, the op outbox,
  // pending photos — lives in IndexedDB and is untouched.
  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        // Once per tab. A reload loop would be worse than a stuck page.
        if (sessionStorage.getItem(BOOT_RECOVERY_KEY)) return;
        // Offline is a legitimate reason to be slow, and dropping the
        // precache while offline would turn a delay into a dead app.
        if (!navigator.onLine) return;
        sessionStorage.setItem(BOOT_RECOVERY_KEY, "1");
        try {
          const registrations =
            (await navigator.serviceWorker?.getRegistrations()) ?? [];
          await Promise.all(registrations.map((r) => r.unregister()));
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {
          // Even if teardown fails, the reload is still worth attempting.
        }
        location.reload();
      })();
    }, BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui",
        color: "#888",
      }}
    >
      bins…
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "An unexpected error occurred.";
  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    detail = error.data?.toString() ?? "";
  } else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "system-ui",
        color: "var(--mantine-color-text)",
        backgroundColor: "var(--mantine-color-body)",
        minHeight: "100vh",
      }}
    >
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
  );
}
