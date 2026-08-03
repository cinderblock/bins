import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  layout("routes/shell.tsx", [
    // "/" — the scanner or the box list, per the deployment's HOME_VIEW.
    index("routes/home.tsx"),
    // The scanner's own stable URL, so browse-home deployments can link to it
    // and so "open the camera" is always a real destination.
    route("scan", "routes/scanner.tsx"),
    // "/123" — one URL per physical box; also the claim flow for fresh stickers.
    route(":binId", "routes/bin.tsx"),
    // Browse + search every box; bulk-move for members, retire/restore +
    // edit for admins. /search is a legacy alias that redirects here.
    route("bins", "routes/bins.tsx"),
    route("search", "routes/search.tsx"),
    route("settings", "routes/settings.tsx"),
    // Sticker codes: allocate + export bin IDs/codes (admin-gated in-page).
    route("print", "routes/print.tsx"),
    // Admin (member + admin password). Linked from Settings.
    route("admin", "routes/admin.tsx"),
    // Unauthenticated: the shell gate lets these two through its auth wall.
    // /join is deliberately UNLINKED (bootstrap/fallback access-code entry).
    route("join", "routes/join.tsx"),
    route("setup", "routes/setup.tsx"),
  ]),
] satisfies RouteConfig;
