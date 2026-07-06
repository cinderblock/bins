# bins — agent orientation

**Read `plans/bins.md` first.** It is the living plan: locked decisions,
architecture map, progress log, and gotchas. Keep it current — update it in
the same turn you make a decision or hit a surprise, and surface its path in
your responses. If `plans/local.md` exists (untracked), read it too — it
holds the operator's private deployment specifics.

## What this is

Standalone, self-hostable, offline-first PWA inventory tracker for group
storage bins: QR sticker per box → `https://your-host/123` → bin page → snap
contents photo / note / location. Fully self-contained — never import code
from other repos. Tenant-agnostic core: nothing about any particular group,
domain, or deployment may appear in tracked files; `group_id` on every
tenant table, and the QR origin always derives from the serving origin.

## Load-bearing invariants (see plan for reasoning)

- Every mutation is an op; `shared/reducer.ts` is the ONE reducer both the
  server (SQLite) and client (Dexie) run. Never write materialized tables
  (bin, bin_entry, location) outside it. `shared/reducer.test.ts` proves
  order-independence — keep it passing and extend it with any new op type.
- Primary photo is derived (latest non-deleted contents_photo), never a field.
- Multi-statement server writes go through `serializedTransaction`
  (api/context.ts) — bun:sqlite interleaves at await points.
- `react-router build` runs under node (not `--bun`): SPA prerender needs
  `renderToPipeableStream`, absent from react-dom's Bun server entry.
- Future service worker: NetworkOnly for `/api/*` (the sync engine owns
  retries), CacheFirst only for `/api/blobs/**`.

## Stack & conventions

Bun · React Router v7 (**SPA mode**, `ssr:false`) · React 19 · Mantine 8
(dark default, mobile-first, bottom-center toasts) · Dexie · Drizzle/SQLite ·
Biome · TS strict. Scripts: `bun run dev | build | start | test | typecheck |
lint | format | db:generate | db:migrate`.
