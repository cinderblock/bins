# bins — living plan

Standalone offline-first inventory tracker (QR sticker per box → bin page →
snap/note/locate). Fully self-contained — no code imports from other repos,
ever — and **publishable**: tracked files carry zero operator/tenant
specifics. Those live in untracked `plans/local.md` (read it too if present).

## Goal

Fast scan → snap → next-box flow for group storage. Group-agnostic core that
anyone can self-host on their own domain + database (first-tenant details:
`plans/local.md`). Installed PWA with a full local replica so it works in
dead zones (storage units, remote sites), merging back to the server later.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\bins` (git, master).
- Deploy shape: Bun on a unix socket behind any TLS reverse proxy, GH Actions
  release-tree deploy (`.github/workflows/deploy.yml`, runner label `bins`).
  QR/sticker URLs always derive from the serving origin — self-hosters get
  their own sticker format for free. This operator's target host/domain and
  pending ops-side work: `plans/local.md`.
- Dev on Windows: `bun run dev` = Vite web :3000 + Bun API :3001 (proxied
  `/api`). Prod unix-socket path is Linux-only; never test `server.ts` locally
  on Windows.

## Decisions already made (don't re-ask)

- **Name**: `bins`. **Access**: no accounts; joining mints a long-lived device
  bearer token (localStorage/Dexie, not cookies). Two ways to join (both →
  the same token): (a) scan a sticker — see "Per-bin secret codes" below —
  proof of physical access, prompts for name only; (b) the shared group access
  code, kept as the bootstrap path (someone must join before the first
  stickers can be allocated) and as fallback.
- **URL format (2026-07-06, implemented)**: QR encodes `/{number}#{CODE}`
  (e.g. `/1#7HX6`) — the raw URL FRAGMENT is a short per-bin secret. Fragment,
  not query string (user decision 2026-07-06): fragments never reach the
  server, so codes can't accumulate in reverse-proxy access logs. The parser
  tolerates `?CODE` and `code=` forms for hand-typed input. Typing a bare
  `/123` without a token gets you nothing. Deliberately low security: seeing
  one sticker lets you in; the append-only op log means vandalism is
  recoverable (rebuild/inspect the log). See the spec section below.
- **Sync**: custom append-only op log; NO Replicache/PowerSync/ElectricSQL.
  LWW per scalar field via `(effectiveTime, opId)` clocks; entries append-only;
  primary photo DERIVED (latest non-deleted contents_photo) — never settable.
  HLCs were considered and dropped: uuidv7 opIds + server clock-clamp
  (`effectiveTime = min(clientTime, serverNow + 60s)`) cover the same needs.
- **SPA mode** (`ssr: false`): offline boot from cached assets; all content
  auth-gated. server.ts serves static + `/api/*` + SPA fallback.
- **Short IDs**: one global integer sequence (starts at 100) across groups —
  the URL can't carry a group; the token is the authorization. Stickers are
  batch-allocated per group as server-authored `bin.allocate` ops so fresh
  stickers are claimable offline.
- **Multi-group single deploy**: `group_id` on every tenant table.
- **Voice notes**: keyboard-dictation-first (works offline/on-device on both
  platforms); Android-only SpeechRecognition mic as enhancement. No custom
  iOS mic feature — unreliable in installed PWAs.
- Mantine **8**, dark default, bottom-center toasts.
- **Publishable / tenant-agnostic (2026-07-06)**: the repo will be published
  for anyone to self-host. No tenant, domain, host, or sibling-project names
  in tracked files — operator specifics go in untracked `plans/local.md`.
  Master history was rewritten to a fresh clean root on 2026-07-06; publish
  by pushing master only (checklist in `plans/local.md`).

## Architecture map

- `shared/` — the protocol core (isomorphic): `ops.ts` (zod wire schema),
  `reducer.ts` (the ONE reducer both sides run), `memory-store.ts` (tests).
- `db/` — Drizzle SQLite. Authoritative: group, device, op, photo_blob.
  Materialized (rebuildable via `scripts/rebuild-materialized.ts`): bin,
  bin_entry, location. `store.server.ts` = Drizzle StateStore adapter.
- `api/` — hand-rolled router. join/me/devices, sync push/pull, blobs
  (content-addressed PUT/GET/HEAD), allocate. Writes serialize through
  `serializedTransaction` (bun:sqlite is one sync connection; awaits
  interleave, so multi-statement writes need the queue + BEGIN IMMEDIATE).
- `app/` — SPA. `lib/db.ts` Dexie replica + outboxes; `lib/sync.ts` engine
  (push → pull → blob upload → devices map; triggers: enqueue/online/
  visibility/60s); `lib/store.client.ts` Dexie StateStore adapter;
  `lib/camera.ts` shared MediaStream singleton (never re-negotiate between
  scans); `lib/actions.ts` = the only place ops are built. Routes: scanner
  (`/`), bin (`/:binId`, claim-in-place for unclaimed), search, settings,
  print.

## Spec: per-bin secret codes (IMPLEMENTED 2026-07-06)

User decision 2026-07-06. QR stickers encode `/{binId}?{CODE}`; a valid
(id, code) pair seen once = "login" (mints the normal device token). Bare
`/123` typed by hand grants nothing. Codes are per-bin, short, printed on the
sticker; after joining, edits never need a bin's code again.

As-built deviations from the touchpoint list below:

- `bin.secret_code` is NULLABLE, not NOT NULL: `BinState.secretCode` must be
  `string | null` anyway (a claim can outrun its allocate on a replica,
  leaving a code-less stub), and one shared shape across both store adapters
  beats a server-only constraint. Server rows always get a code in practice
  (push rejects ops on unknown bins). Migration 0001 (additive), not a
  regenerated 0000.
- Allocate response changed shape: `{ binIds }` → `{ bins: [{ id, code }] }`.
- The print page reads codes from the Dexie replica (they ride the allocate
  ops), rendering "waiting for sync…" placeholders until the pull lands — it
  never prints a code-less QR.
- Code helpers (`SECRET_CODE_ALPHABET`, `normalizeSecretCode`,
  `secretCodeSchema`) live in `shared/ops.ts`; generation in `api/allocate.ts`
  keeps the trivial modulo bias (low-security by design).
- User decision (2026-07-06, supersedes touchpoint 6's "keep the code in the
  URL"): the code does NOT stay in the URL after use. In-app scans navigate
  straight to `/{id}` (the session is already authenticated), and FirstRun
  redirects to `/{id}` after a successful sticker join — the canonical URL is
  what belongs in history/share sheets.
- User decision (2026-07-06, supersedes touchpoints 6/8's query string): the
  code rides the URL FRAGMENT (`/{id}#{CODE}`), keeping it out of server logs.
  `binIdFromScan` checks the fragment first and still tolerates `?CODE` /
  `code=` forms; unit-tested in `app/lib/format.test.ts`.

Original implementation touchpoints (in dependency order):

1. **Code format**: 4 chars from Crockford-style alphabet
   `23456789ABCDEFGHJKMNPQRSTVWXYZ` (no 0/1/I/L/O/U confusables), generated
   server-side with `crypto.getRandomValues`. Compare case-insensitively.
   Stored plaintext (low security by design; needed to re-render sticker
   sheets).
2. **Schema**: `bin.secretCode` text NOT NULL (fresh migration; db has no real
   data yet — regenerating migration 0000 is also fine). Also add to
   `BinState` in `shared/reducer.ts` + both store adapters + `db/schema/bin.ts`.
3. **shared/ops.ts**: `bin.allocate` payload becomes `{ code: string }` so the
   code reaches every member replica through normal sync (print page re-render
   + sharing sticker URLs from the app). Reducer: `bin.allocate` sets
   `secretCode` from payload. Extend `shared/reducer.test.ts`.
4. **api/allocate.ts**: generate the code per bin, put it in the op payload.
5. **New endpoint** `POST /api/auth/join-by-bin`
   `{ binId, code, displayName, deviceId }` → look up bin (any status incl.
   unclaimed), case-insensitive code match → mint device token for the bin's
   group (same response shape as /api/auth/join). Wrong pair → 403. Keep
   /api/auth/join (access code) working.
6. **app/lib/format.ts**: `binIdFromScan` → return `{ binId, code? }`; the
   code is the RAW query string (`/1?7HX6`), but tolerate `?code=7HX6` too.
   Scanner navigates to `/{id}?{code}` (keep the code in the URL so an
   unauthenticated helper can be handed the phone mid-scan).
7. **FirstRun / shell gate**: when unauthenticated AND the current location
   matches `/{id}?{code}`, show a name-only join card (join-by-bin, then
   continue straight to that bin page); otherwise the existing access-code
   form. This is the primary onboarding path once stickers exist.
8. **print.tsx**: QR value + caption URL become `origin/{id}?{CODE}`; print
   the code as text under the bin number (human fallback for manual login).
9. **Tests**: api.test.ts — allocate returns/embeds codes; join-by-bin happy
   path, wrong code 403, unclaimed bin OK; bare-number join impossible.

Non-goals: rotating codes, rate limiting beyond the trivial, revoking a
leaked sticker (retire the bin instead).

## Progress log

- [x] Phase 0 — scaffold: repo, tooling configs, migration,
  build/typecheck/lint/test green.
- [x] Phase 1 — MVP: full schema, protocol core + reducer, join flow, bin page
  (photos w/ derived primary, notes w/ time+geo, location sheet), allocate +
  print sheet, create-group script + BOOTSTRAP_* envs, deploy.yml.
- [x] Phase 2 (core) — continuous scanner root (barcode-detector ponyfill,
  torch, reticle, recent bins, manual-entry fallback), camera singleton reuse.
- [x] Phase 3 (data layer) — Dexie replica, op outbox w/ optimistic apply,
  blob outbox (upload retry, thumbs kept forever), device-name cache. Built
  early because the "online-only" variant would have been throwaway.
- [x] Tests: 6 reducer convergence (order-independence + re-application) + 6
  API integration (join/allocate/push/pull/idempotency/foreign-bin/blob).
- [x] **Per-bin secret codes** (2026-07-06) — full spec implemented (see spec
  section incl. as-built deviations): schema+migration 0001, allocate embeds
  codes in ops, `/api/auth/join-by-bin`, scanner keeps `?CODE` in the URL,
  sticker-URL FirstRun gate (name-only join + access-code fallback), print
  page QR/caption/code text. Tests: reducer claim-before-allocate convergence
  + API join-by-bin suite (14 pass).
- [ ] Phase 3 (PWA shell) — vite-plugin-pwa: manifest (standalone, portrait,
  icons incl. maskable), Workbox precache + navigateFallback, update prompt
  (NEVER auto-reload), CacheFirst `/api/blobs/**`, **NetworkOnly `/api/*`**,
  `navigator.storage.persist()` already called at first-run. Icons needed.
- [x] Publishability sweep (2026-07-06) — scrubbed all tenant/host strings
  from tracked files (`.env.example`, deploy.yml, CLAUDE.md, comments,
  README, this plan); operator specifics moved to untracked `plans/local.md`.
- [ ] Deploy — create GitHub repo (push master only — history already clean;
  see `plans/local.md`), register runner + host layout + reverse-proxy block
  per `plans/local.md`; then push & watch CI.
- [ ] Phase 4 — per-device unclaimed-ID reserve (offline new-box without
  sticker), print layout for real label stock, location reorder, retired-bin
  browsing, unarchive places UI.
- [ ] Phase 5 — AI embellishment: server job (gated on ANTHROPIC_API_KEY) runs
  Claude vision over new contents photos → server-authored `bin.aiItems` ops →
  feeds search for free. Schema/op type not yet defined.
- [ ] On-device testing (iPhone + Android): camera lifecycle in installed PWA,
  scan-to-bin latency, airplane-mode round-trip on two devices.

## Findings / gotchas

- **react-router typegen auto-ran `pnpm install`** when `@react-router/node`
  was missing — corrupted bun's node_modules (`.pnpm` dir) and broke the build
  with a phantom `react-dom/server.bun.js` export error. Fix: keep
  `@react-router/node` in deps; if it recurs, delete node_modules + `bun
  install`.
- **`react-router build` must run under node, not `--bun`**: SPA mode executes
  a prerender of index.html at build; Bun resolves `react-dom/server` to
  `server.bun.js`, which lacks `renderToPipeableStream`. (SSR builds don't
  hit this — they never render at build time.)
- Convergence bugs the tests caught (don't reintroduce): bin `createdAt` must
  fold as **min** over ops (get-or-create stamping breaks order-independence);
  entry.remove arriving before its entry.add must still touch the bin's
  updatedAt (tombstone branch calls refreshDerived too).
- `<img>` can't send the bearer header → photos are fetched via
  authenticated `fetch` and cached as blobs in Dexie (`getPhotoBlob`), which
  doubles as the offline photo cache for other devices' photos.
- fieldClocks JSON key order varies by op application order — any state
  comparison must canonicalize (see MemoryStore.snapshot).

## Things not to do

- Don't cache `/api/*` in the future service worker — the sync layer owns
  retries; a SW cache would fight the replica.
- Don't make primary photo settable, and don't write materialized tables
  outside the reducer (allocation emits ops for exactly this reason).
- Don't import code from other repos. Don't put any tenant/operator specifics
  (domain, host, group names, sibling projects) into tracked files — they go
  in untracked `plans/local.md`.
- Don't re-negotiate getUserMedia between scans (slow; iOS re-prompts).
- Don't run multi-statement DB writes outside `serializedTransaction`.
