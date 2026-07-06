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

import type { Route } from "./+types/root";

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
        <Meta />
        <Links />
        <ColorSchemeScript defaultColorScheme="dark" />
        <style>{earlyColorSchemeCss}</style>
      </head>
      <body>
        <MantineProvider defaultColorScheme="dark">
          {/* Bottom-center: toasts land in the thumb/glance zone, confirming
              fast-flow actions ("Photo saved") without reaching. */}
          <Notifications position="bottom-center" />
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
