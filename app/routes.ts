import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  layout("routes/shell.tsx", [
    // "/" — the live QR scanner; the app's home is a camera.
    index("routes/scanner.tsx"),
    // "/123" — one URL per physical box; also the claim flow for fresh stickers.
    route(":binId", "routes/bin.tsx"),
    route("search", "routes/search.tsx"),
    route("settings", "routes/settings.tsx"),
    // Sticker sheet: inside the shell (needs auth) but print CSS strips chrome.
    route("print", "routes/print.tsx"),
  ]),
] satisfies RouteConfig;
