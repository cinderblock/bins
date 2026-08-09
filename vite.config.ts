import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import tsconfigPaths from "vite-tsconfig-paths";
import { SERVICE_WORKER_FILENAME } from "./release-assets";

const publicHost = process.env.PUBLIC_BASE_URL
  ? new URL(process.env.PUBLIC_BASE_URL).hostname
  : undefined;

// In dev the Vite server only serves the SPA; the API runs as a separate Bun
// process (api/dev.ts, TCP) and Vite proxies /api to it. In production
// server.ts serves both from one process on a unix socket.
const apiPort = Number(process.env.API_PORT ?? 3001);

export default defineConfig({
  // Stamp the commit into the bundle so a device can report which build it is
  // actually running (see app/lib/api.ts). CI provides GITHUB_SHA; a local
  // build is just "dev".
  define: {
    __BUILD_SHA__: JSON.stringify(
      process.env.GITHUB_SHA ?? process.env.BUILD_SHA ?? "dev",
    ),
  },
  plugins: [
    reactRouter(),
    tsconfigPaths(),
    VitePWA({
      // "prompt": a waiting SW NEVER auto-activates — mid-capture reloads
      // would lose work. PwaUpdatePrompt shows a toast; the user decides.
      registerType: "prompt",
      // Not vite-plugin-pwa's default `sw.js` — see SERVICE_WORKER_FILENAME.
      filename: SERVICE_WORKER_FILENAME,
      // Registration + head links are hand-rolled (app/root.tsx) because the
      // SPA-mode index.html is prerendered by React, not vite's HTML pipeline.
      injectRegister: false,
      manifest: {
        name: "bins",
        short_name: "bins",
        description: "Scan a box, see what's inside.",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        theme_color: "#242424",
        background_color: "#242424",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Push + notificationclick handlers, kept OUT of the generated SW so
        // this stays a generateSW build (see public/push-sw.js for why).
        importScripts: ["/push-sw.js"],
        globPatterns: ["**/*.{js,css,svg,png,ico,woff2,wasm}"],
        // React Router SPA mode writes index.html AFTER the client bundle
        // closes, so the glob can't see it — add it explicitly (revision
        // bumps every build; its content embeds hashed asset names anyway).
        //
        // `assets/manifest-*.js` is written later still — after the whole Vite
        // build, so not even a `closeBundle` hook can reach it. It is added by
        // the `precache:route-manifest` build step; leaving it out of the
        // precache is what stranded every installed device on every deploy.
        additionalManifestEntries: [
          { url: "/index.html", revision: Date.now().toString(36) },
        ],
        // zxing-wasm (the BarcodeDetector ponyfill fallback) is ~1.3 MB.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Offline boot: any navigation serves the precached SPA shell…
        navigateFallback: "/index.html",
        // …but never API routes. The repair page lives under /api for exactly
        // this reason: that prefix is in the denylist of every worker ever
        // deployed, so /api/r reaches the server even from a device stranded
        // on an old build. A prettier /reset would only work for builds new
        // enough to already know about it — i.e. not the ones that need it.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Photo bytes are content-addressed — immutable, cache-first
            // forever. (Order matters: this must precede the /api/ rule.)
            urlPattern: /\/api\/blobs\/[0-9a-f]{64}$/,
            handler: "CacheFirst",
            options: {
              cacheName: "blobs",
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 500, purgeOnQuotaError: true },
            },
          },
          {
            // Everything else under /api is the sync engine's business — it
            // owns retries; a SW cache would fight the replica.
            urlPattern: /\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    port: Number(process.env.PORT ?? 3000),
    allowedHosts: publicHost ? [publicHost] : undefined,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
});
