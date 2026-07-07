/**
 * Dev-only API server on TCP (Vite proxies /api here — see vite.config.ts).
 * Production uses server.ts instead, which serves the SPA and the API from
 * one process on a unix socket.
 */
import { handleApi } from "./router";

const port = Number(process.env.API_PORT ?? 3001);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, url);
    return new Response("bins api (dev)", { status: 200 });
  },
});

console.log(`bins api (dev) listening on http://localhost:${port}`);
