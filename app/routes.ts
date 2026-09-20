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
    // "/new" — the label studio for a box that isn't allocated until it must
    // be (first save, drawing or print). Admin only.
    route("new", "routes/new.tsx"),
    // "/123" — one URL per physical box; also the claim flow for fresh stickers.
    route(":binId", "routes/bin.tsx"),
    // "/b/<uuid>" — the same page by opaque handle, the form deployments that
    // keep box numbers internal print on their stickers (see lib/boxRef.ts).
    route("b/:handle", "routes/bin.tsx", { id: "routes/bin-by-handle" }),
    // Browse + search every box; bulk-move for members, retire/restore +
    // edit for admins. /search is a legacy alias that redirects here.
    route("bins", "routes/bins.tsx"),
    // The virtual wall: every bay, shelf and slot with the box in it.
    route("shelves", "routes/shelves.tsx"),
    route("search", "routes/search.tsx"),
    route("settings", "routes/settings.tsx"),
    // Sticker codes: allocate + export bin IDs/codes (admin-gated in-page).
    route("print", "routes/print.tsx"),
    // Admin (member + admin password). Linked from Settings.
    route("admin", "routes/admin.tsx"),
    // The URL to open on a new device: unlock once, save a passkey.
    route("admin/passkey", "routes/admin-passkey.tsx"),
    // Unauthenticated: the shell gate lets these two through its auth wall.
    // /join is deliberately UNLINKED (bootstrap/fallback access-code entry).
    route("join", "routes/join.tsx"),
    route("setup", "routes/setup.tsx"),
  ]),
] satisfies RouteConfig;
