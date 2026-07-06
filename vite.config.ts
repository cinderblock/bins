import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const publicHost = process.env.PUBLIC_BASE_URL
  ? new URL(process.env.PUBLIC_BASE_URL).hostname
  : undefined;

// In dev the Vite server only serves the SPA; the API runs as a separate Bun
// process (api/dev.ts, TCP) and Vite proxies /api to it. In production
// server.ts serves both from one process on a unix socket.
const apiPort = Number(process.env.API_PORT ?? 3001);

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  server: {
    port: Number(process.env.PORT ?? 3000),
    allowedHosts: publicHost ? [publicHost] : undefined,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
});
