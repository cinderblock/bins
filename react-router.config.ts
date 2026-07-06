import type { Config } from "@react-router/dev/config";

// SPA mode: the app must boot entirely from service-worker-cached static assets
// when offline, and all content is auth-gated (no SEO), so SSR buys nothing.
// `react-router build` emits build/client/index.html; server.ts serves it as
// the fallback for every non-asset, non-API GET (which is what makes /123
// resolve).
export default {
  ssr: false,
} satisfies Config;
