# bins

Offline-first PWA inventory tracker for group storage bins. Stick a QR code on
every box; scanning it opens that bin's page — latest top-down contents photo,
notes, location — with one-tap ways to add more. Group-agnostic by design:
any club, hackerspace, event crew, or family with too many totes can
self-host it on their own domain and database.

**The fast flow:** open the app → it's a live scanner → point at a box →
bin page appears → snap a contents photo / dictate a note / set location →
back → scan the next box. Every addition records who, when, and (with consent)
where.

## Features

- **QR-first**: `https://your-host/123#7HX6` on a sticker is the whole UX
  entry point — the URL fragment is that bin's secret, so scanning any
  sticker once proves physical access and logs you in (a hand-typed bare
  `/123` grants nothing, and the fragment never appears in server logs).
  Print sticker sheets in-app; fresh stickers are claimed on first scan
  (works offline — allocations sync into every device's replica beforehand).
- **Offline-first**: full local replica (IndexedDB), append-only op-log sync
  with last-writer-wins merges, photos captured offline upload later. Built
  for storage units, basements, and other dead zones.
- **"Which box is X in"** search over names, labels, and notes — offline,
  fuzzy ("sharpee" finds the Sharpies).
- **No accounts**: scanning any sticker once IS the login — pick a display
  name and you're in. Signed-out visitors on any other URL get a branded
  landing page (title/subtitle set per group; the shared access code lives
  only at an unlinked `/join` as the bootstrap path). One deploy hosts many
  groups (`group_id` on every tenant table).
- **First-boot setup & admin**: a fresh database greets the first visitor
  with a setup wizard (group name, landing branding, access code, admin
  password) that also joins them as the first member. A password-gated admin
  page handles branding edits, importing pre-printed stickers (`id,code`
  lines), and device revocation.
- **Photos done right**: on-device downscale (~300 KB), content-addressed
  (sha256) storage, latest top-down shot automatically becomes the bin's
  primary picture.
- **Phone-first, desktop-aware**: phones boot straight into the live
  scanner; desktops get an opt-in camera (type a bin number instead — the
  webcam faces you, not the boxes), centered page columns instead of
  stretched mobile layouts, and dialogs where phones get bottom sheets.

## Stack

Bun · React Router v7 (SPA mode) · React 19 · Mantine 8 · Dexie (IndexedDB) ·
Drizzle + SQLite (server) · Biome. The op-log reducer in `shared/` is
isomorphic — the exact same code materializes state on the server (SQLite) and
in the browser (IndexedDB), which is what makes offline merge trustworthy
(see `shared/reducer.test.ts`).

## Development

```sh
bun install
cp .env.example .env
bun run dev              # web on :3000, API on :3001 (Vite proxies /api)
```

Open http://localhost:3000 — a fresh database opens the first-boot setup
wizard; create your group and you're the first member. Allocate stickers
under Print and scan away. Camera APIs need a secure context — on a phone,
use a TLS-terminating proxy to your dev machine or test against a deploy.

Checks: `bun test` (reducer convergence + API integration), `bun run
typecheck`, `bun run lint`, `bun run build`.

## Deployment

Single Bun process on a unix socket behind any TLS reverse proxy:

```sh
bun run build
SOCKET_PATH=/run/bins/bins.sock DATABASE_PATH=/srv/bins/data/bins.db \
  PHOTOS_PATH=/srv/bins/data/photos bun server.ts
```

SQLite migrates itself on boot; the first visit to a fresh instance opens the
setup wizard. `.github/workflows/deploy.yml` holds the reference release-tree
deploy (atomic symlink flip + `/_version` health check).

## How sync works (short version)

Every mutation is an **op** (`bin.claim`, `entry.addPhoto`, `bin.setLocation`,
…) with a uuidv7 id. Clients apply ops to their replica optimistically and
queue them; the server assigns a global sequence, clamps client clocks, and
materializes the same reducer into SQLite. Pulls replay canonical ops — the
reducer is idempotent and order-independent (scalar fields: per-field
last-writer-wins clocks; photos/notes: append-only; the primary photo is
derived, so it can't conflict). Photo bytes travel separately, content-
addressed by sha256, so uploads are retry-safe and ops can reference photos
that haven't finished uploading.

## License

MIT
