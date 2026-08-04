/**
 * Deploy-time configuration.
 *
 * These are deliberately env vars with NO admin UI. The trust model has to be
 * configured by whoever configures the reverse proxy, because the two only
 * make sense together — an admin one mis-click away from turning an
 * internet-facing deployment into an open one is a bad design, not a
 * convenience.
 *
 * Everything here defaults to the closed, pre-existing behavior.
 *
 * These are functions, not module-level consts, so the environment is read at
 * call time. That costs nothing on these paths (join, allocate and landing
 * are all rare) and it keeps the flags testable — a const captured at import
 * would freeze whatever the environment happened to be when the first test
 * file loaded this module.
 */

/**
 * An unrecognized value falls back rather than counting as false. That matters
 * for the fail-safe direction: a typo'd `OPEN_ACCESS_REQUIRE_PRIVATE_CLIENT`
 * must not quietly disable a backstop whose default is on.
 */
function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

/**
 * This deployment sits behind a network perimeter (a LAN, a VPN) and does not
 * need per-bin sticker secrets:
 *
 * - `POST /api/auth/join-open` exists — a display name alone joins the group.
 * - Signed-out visitors get a name-only join card instead of the landing page.
 * - Allocated stickers carry NO secret code, so their QR is a bare `/{id}`.
 *
 * The display-name prompt stays either way: it is one screen once per device
 * and it is the entire basis of op attribution.
 */
export function isOpenAccess(): boolean {
  return envFlag("OPEN_ACCESS");
}

/**
 * A label-printing service that accepts a LABEL SPEC (title / url / lines),
 * not pixels. Unset = no printing offered; the sticker-code export stays the
 * only path, which is what pre-printed-sticker operators use.
 *
 * The repo stays printer-agnostic on purpose: media size, layout, artwork,
 * dithering and printer command language all live behind this URL. bins only
 * knows what a bin IS.
 */
export function labelPrintUrl(): string | null {
  return process.env.LABEL_PRINT_URL?.trim() || null;
}

/** Optional bearer for the above. Server-side only — never sent to a client. */
export function labelPrintToken(): string | null {
  return process.env.LABEL_PRINT_TOKEN?.trim() || null;
}

/**
 * Label stock geometry, `WxH@DPI` in inches — e.g. `4x6@203`.
 *
 * Required to render at all: the app cannot guess what's loaded in someone's
 * printer, and getting it wrong wastes physical material. Defaults to the
 * common 4x6 thermal shipping label.
 */
export function labelSizeRaw(): string {
  return process.env.LABEL_SIZE?.trim() || "4x6@203";
}

/**
 * The origin a printed QR must encode.
 *
 * In the browser, sticker URLs derive from `window.location.origin` — one
 * origin per deployment is load-bearing (manifest scope, service worker,
 * stored identity), so there is nothing to choose. Server-side there is no
 * such window, and a URL printed onto a physical label is permanent, so this
 * prefers the explicitly configured origin over anything a request header
 * claims. A spoofed Host must not end up on a sticker.
 */
export function publicOrigin(fallback: string): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (!configured) return fallback.replace(/\/+$/, "");
  return configured.replace(/\/+$/, "");
}

export type BoxNumbers = "public" | "internal";

/**
 * Whether the box number means anything to the people using this deployment.
 *
 * - `public` (default) — the number is printed on the physical container and
 *   people say it out loud ("grab bin 47"). It leads the UI.
 * - `internal` — containers are drawn from a pile of empties and relabeled;
 *   the id is just the URL handle, and a sequential integer would imply a
 *   durable property the box doesn't have. The box's NAME leads instead, and
 *   the number is a quiet fallback for boxes that don't have a name yet.
 *
 * This changes presentation only. Ids stay integers from one monotonic
 * sequence either way — that is what guarantees they are never reused, which
 * is what makes a leftover sticker identifiable rather than dangerous.
 */
export function boxNumbers(): BoxNumbers {
  return process.env.BOX_NUMBERS?.trim().toLowerCase() === "internal"
    ? "internal"
    : "public";
}

export type HomeView = "scanner" | "browse";

/**
 * Which surface the app opens on.
 *
 * - `scanner` (default) — the camera IS the home screen. Right when the job is
 *   "work through this pile of boxes": scan, snap, next.
 * - `browse` — open on the box list + search, with scanning one prominent tap
 *   away. Right when the job is "which box is the thing in", which is what a
 *   standing warehouse looks like.
 *
 * Deliberately NOT tied to OPEN_ACCESS: a network perimeter has nothing to do
 * with whether you want a camera or a list first. Two orthogonal facts about a
 * deployment.
 */
export function homeView(): HomeView {
  return process.env.HOME_VIEW?.trim().toLowerCase() === "browse"
    ? "browse"
    : "scanner";
}

/**
 * Backstop for a proxy misconfiguration: refuse open joins from a client that
 * did not arrive from a private address. This is NOT the perimeter — the
 * reverse proxy is — it just means a bad proxy rule isn't instantly an open
 * door. Defaults ON with OPEN_ACCESS; set to 0 for deployments whose
 * perimeter is something else (a VPN handing out public addresses, say).
 */
function requirePrivateClient(): boolean {
  return envFlag("OPEN_ACCESS_REQUIRE_PRIVATE_CLIENT", true);
}

/**
 * The client address as reported by the reverse proxy. Only meaningful when
 * something trusted sets the header — which is exactly why this is a backstop
 * for a perimeter rather than a perimeter itself. Takes the FIRST entry: with
 * a trustworthy proxy that is the real client, and a spoofed header can only
 * ever be a problem on a deployment whose proxy already isn't filtering.
 */
export function forwardedClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return stripIpv6Brackets(first);
  const real = req.headers.get("x-real-ip")?.trim();
  return real ? stripIpv6Brackets(real) : null;
}

function stripIpv6Brackets(address: string): string {
  // Some proxies emit `[::1]:1234` or `1.2.3.4:1234`.
  const bracketed = address.match(/^\[(.+)\]/);
  if (bracketed?.[1]) return bracketed[1];
  // Only strip a port from IPv4 — a bare IPv6 is full of colons.
  const withPort = address.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  return withPort?.[1] ?? address;
}

/** RFC1918 + loopback + link-local, v4 and v6. */
export function isPrivateAddress(address: string | null): boolean {
  if (!address) return false;
  const addr = address.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is an IPv4 address wearing a hat.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped?.[1] ?? addr;

  const octets = v4.split(".");
  if (octets.length === 4) {
    const [a, b] = octets.map((o) => Number(o));
    if (a === undefined || b === undefined) return false;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (addr === "::1") return true;
  // fc00::/7 (unique local) and fe80::/10 (link local).
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(addr)) return true;
  return false;
}

/**
 * Whether an open join is permitted for this specific request.
 *
 * A MISSING forwarded header counts as not-private, i.e. refused. In
 * production the app binds a unix socket and the proxy is expected to set the
 * header (the reference Caddy block does), so an absent one means the proxy
 * isn't configured the way this mode assumes — which is precisely the case
 * this backstop exists to catch. Dev servers and tests, which have no proxy
 * at all, set `OPEN_ACCESS_REQUIRE_PRIVATE_CLIENT=0`.
 */
export function openJoinAllowed(req: Request): boolean {
  if (!isOpenAccess()) return false;
  if (!requirePrivateClient()) return true;
  return isPrivateAddress(forwardedClientIp(req));
}
