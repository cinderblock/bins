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

declare global {
  interface Window {
    /** Set once the app hydrates — read by bootWatchdogJs. */
    __binsBooted?: boolean;
  }
}

import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import { RECOVER_URL, StaleBuildBanner } from "./components/StaleBuildBanner";
import { reportError } from "./lib/errors";
import { TOAST_BOTTOM } from "./lib/ui";

// Paint the right background on the very first frame (before JS/CSS), so a
// dark-mode phone never flashes white. Dark is the app default — this tool
// lives in dim storage containers and behind camera viewfinders.
const earlyColorSchemeCss = `
:root { color-scheme: dark; }
html { background-color: #242424; }
html[data-mantine-color-scheme="light"] { background-color: #ffffff; color-scheme: light; }
`;

/**
 * How long to wait before deciding the app has failed to boot. Generous: a
 * cold cache on a slow phone over a busy LAN can legitimately take a few
 * seconds, and a false trigger costs a reload.
 */
const BOOT_TIMEOUT_MS = 10_000;
const BOOT_RECOVERY_KEY = "bins:boot-recovery";

/** When the manual "Repair" link appears on a boot that's taking too long. */
const BOOT_REPAIR_LINK_MS = 6_000;

/**
 * Self-heal a service worker that can no longer boot the app.
 *
 * Every deploy rehashes the assets. An installed worker keeps serving the
 * index.html it precached; if that shell asks for a chunk which no longer
 * exists, the app never hydrates and the boot fallback stays on screen
 * forever. The update prompt that would replace the worker is a component
 * INSIDE the app, so it never gets to run — the fix is trapped behind the
 * thing it fixes.
 *
 * This has to be an inline script, NOT a React effect. It shipped as a
 * `useEffect` in HydrateFallback first, which was useless in the exact case it
 * was written for: hydration is what's broken, so the effect never ran (proved
 * on a stuck page — the sessionStorage guard below was still unset). An inline
 * script in the prerendered shell is the last code still running in that
 * state.
 *
 * Safe to be aggressive: the caches hold the precached shell and re-fetchable
 * photo bytes. All real data — the replica, the op outbox, pending photos —
 * lives in IndexedDB and is untouched.
 */
const bootWatchdogJs = `
(function () {
  window.__binsBooted = false;
  // Long before the automatic attempt, give the person staring at a stuck
  // screen something to tap. The automatic repair can't help if it already
  // ran once this tab, or if the device is offline-but-reachable.
  setTimeout(function () {
    if (window.__binsBooted) return;
    var link = document.getElementById("bins-repair");
    if (link) link.style.display = "block";
  }, ${BOOT_REPAIR_LINK_MS});
  setTimeout(function () {
    if (window.__binsBooted) return;
    // Offline is a legitimate reason to be slow, and dropping the precache
    // while offline would turn a delay into a dead app.
    if (!navigator.onLine) return;
    try {
      // Once per tab. A reload loop would be worse than a stuck page.
      if (sessionStorage.getItem(${JSON.stringify(BOOT_RECOVERY_KEY)})) return;
      sessionStorage.setItem(${JSON.stringify(BOOT_RECOVERY_KEY)}, "1");
    } catch (e) {}
    var reload = function () { location.reload(); };
    Promise.resolve()
      .then(function () {
        return navigator.serviceWorker
          ? navigator.serviceWorker.getRegistrations()
          : [];
      })
      .then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.unregister(); }));
      })
      .then(function () { return caches.keys(); })
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
      // Even if teardown fails, the reload is still worth attempting.
      .then(reload, reload);
  }, ${BOOT_TIMEOUT_MS});
})();
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
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a build-time
            constant, and it must run without the app — see bootWatchdogJs. */}
        <script dangerouslySetInnerHTML={{ __html: bootWatchdogJs }} />
      </head>
      <body>
        <MantineProvider defaultColorScheme="dark">
          {/* Bottom-center: toasts land in the thumb/glance zone, confirming
              fast-flow actions ("Photo saved") without reaching — but lifted
              clear of the fixed bottom controls they'd otherwise cover.

              `top: auto` is load-bearing. Mantine's container sets `top: 16px`,
              so adding only `bottom` STRETCHED this fixed element between the
              two: a 440px-wide, full-height, invisible column down the middle
              of the screen with `pointer-events: auto`, swallowing every click
              in it while holding no notifications at all. On a phone 440px is
              the whole width, so the app became almost entirely untappable —
              reported as buttons that "aren't clickable", inputs that were
              "greyed out and not editable", and pages that "don't do
              anything".

              `pointerEvents: none` is the belt to that braces: the container
              must never intercept anything regardless of its geometry, and
              only the notifications themselves take clicks. */}
          <Notifications
            position="bottom-center"
            style={{ top: "auto", bottom: TOAST_BOTTOM, pointerEvents: "none" }}
            styles={{ notification: { pointerEvents: "auto" } }}
          />
          <PwaUpdatePrompt />
          <StaleBuildBanner />
          {children}
        </MantineProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // Tells the boot watchdog (see bootWatchdogJs) that hydration happened, so
  // it stands down. Rendering this component at all IS the proof.
  useEffect(() => {
    window.__binsBooted = true;
  }, []);
  return <Outlet />;
}

// Shown while the SPA boots (SPA mode renders this into index.html).
export function HydrateFallback() {
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
      <div style={{ textAlign: "center" }}>
        bins…
        {/* Revealed by bootWatchdogJs if this screen is still up after a few
            seconds. A plain <a>, because in this state nothing else works. */}
        <a
          id="bins-repair"
          href={RECOVER_URL}
          style={{
            display: "none",
            marginTop: "1.5rem",
            color: "#8ab4f8",
            fontSize: "0.9rem",
          }}
        >
          Taking too long? Tap to repair
        </a>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // A render crash is the loudest thing that can happen to a user and, until
  // this, left no trace at all — /bins died on a hooks-order violation and the
  // only signal was someone saying it "doesn't work".
  useEffect(() => {
    reportError("render", error);
  }, [error]);

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
