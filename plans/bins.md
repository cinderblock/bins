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
  code — kept as the bootstrap path, but (user decision 2026-07-06) its form
  is NOT in the visible UI: it lives only at the unlinked `/join` route.
  Signed-out visitors on non-sticker URLs see a branded LANDING page (title/
  subtitle served by `/api/landing`; defaults "{group} Inventory Management
  System" / "Scan a Box to Start"; repo stays tenant-agnostic).
- **First-boot setup + admin (user decisions 2026-07-06)**: fresh db → any
  visit lands on `/setup` (group name, landing branding, access code w/
  generate, admin password, display name) which creates the group AND joins
  the operator as first member; locked once a group exists (extra groups via
  scripts/create-group.ts, which now takes an optional admin password).
  BOOTSTRAP_* envs removed. **Admin model: per-group admin password**
  (hashed on group row; stateless — password rides every /api/admin/*
  request with the member token, held only in page state). Admin page
  (`/admin`, linked from Settings): group name + landing branding,
  access-code/admin-password rotation, paste-import of pre-printed stickers
  (`id,code` lines → server-authored bin.allocate ops; global-id collisions
  skipped per row), device list + revoke (group-scoped), and sticker-sheet
  allocation.
- **Sticker sheets are admin-only (user decision 2026-07-06)**: allocation
  hands out the GLOBAL bin-ID sequence, so it's a provisioning action, not a
  per-member one. The scanner nav no longer has a print button; the `/print`
  page is reached from the admin page's "Sticker sheets" entry (passes the
  already-verified admin password via router nav state) or by direct load
  (prompts for it, like `/admin`). Allocation moved from the member endpoint
  `/api/bins/allocate` to `/api/admin/bins/allocate` behind `requireAdmin`.
- **All-boxes list + roles (user decisions 2026-07-06)**: `/bins` (route
  `routes/bins.tsx`, reached from the scanner nav where print used to be) lets
  EVERYONE browse every active box and bulk-select → **move** (relocate many
  at once via `bin.setLocation`). Unlocking with the admin password (inline
  modal, or nav-state from elsewhere) additionally shows RETIRED boxes and adds
  per-box **edit** (name/location/label) + **retire/restore**. Retire is now
  ADMIN-ONLY and server-enforced: `bin.retire` moved from the client push
  schema to server-authored, joined by a new `bin.restore`; both are authored
  by `/api/admin/bins/{retire,restore}` behind `requireAdmin` (mirrors
  allocate) and reach replicas via normal pull. The old member-facing "Retire
  bin" menu on the bin page is gone. Status stays LWW on the `status` clock, so
  claim/retire/restore just compete like any field (reducer.test extended).
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
  bin_entry, location, label. `store.server.ts` = Drizzle StateStore adapter.
  (Bin label MEMBERSHIP is not its own table — it lives on `bin.label_ids`,
  LWW per label; only the label *definitions* get a table.)
- `api/` — hand-rolled router. join/join-by-bin/me/devices, landing + setup
  (unauth), admin (member token + per-request admin password), sync
  push/pull, blobs (content-addressed PUT/GET/HEAD), allocate (admin). Writes
  serialize through
  `serializedTransaction` (bun:sqlite is one sync connection; awaits
  interleave, so multi-statement writes need the queue + BEGIN IMMEDIATE).
- `app/` — SPA. `lib/db.ts` Dexie replica + outboxes; `lib/sync.ts` engine
  (push → pull → blob upload → devices map; triggers: enqueue/online/
  visibility/60s); `lib/store.client.ts` Dexie StateStore adapter;
  `lib/camera.ts` shared MediaStream singleton (never re-negotiate between
  scans); `lib/actions.ts` = the only place ops are built. Routes: scanner
  (`/`, AUTO-SCAN mode — see below), bin (`/:binId`, claim-in-place for
  unclaimed), bins (all-boxes list), search, settings, print, admin, plus
  unauthenticated join
  (unlinked) + setup (first boot). Shell gate order for signed-out visitors:
  sticker URL → FirstRun join card; /join, /setup → their routes; anything
  else → Landing (branding via /api/landing, offline fallback text).

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

## Spec: integration tokens + public API (PROPOSED 2026-07-06)

User request 2026-07-06: "APIs and access tokens for other apps we control to
read (and maybe write) data and embed the info into other apps." Scope calls
locked by the user (2026-07-06):

- **Consumers**: BOTH server-side (secret held privately) and browser/client
  (token exposed) — distinguished by scope, so a read-only token is safe to
  embed in a front-end while read+write is reserved for trusted backends.
- **Access**: read AND write. Writes MUST be ops through `shared/reducer.ts`
  (the load-bearing invariant) — an integration authors ops exactly like a
  device, never touching materialized tables.
- **API shape**: BOTH — a simple versioned query/embed REST surface over
  materialized state, AND op-log sync access (pull/push) for apps that want a
  live local mirror.

### The pivot: how does an integration author ops?

**DECIDED 2026-07-06: model (A).** `op.deviceId` (author) has a hard FK to
`device` (`db/schema/op.ts:28`). Two ways to give an integration a valid
author identity were considered:

- **(A, CHOSEN) An integration IS a `device` row** with `kind =
  "integration"`, a `scope`, and optional CORS `allowedOrigins`. Everything
  reuses existing machinery for free: `authenticate()` resolves it, op
  authorship + the `/api/devices` name cache attribute it, revoke = delete
  row. Migration only ADDS columns to `device` (kind/scope/allowedOrigins/
  tokenPrefix); no `op` table rebuild. Cost: overloads the "device = phone/
  install" concept — the human device list must filter out `kind =
  "integration"`, and the admin integrations list filters the opposite way.
- **(B) A separate `integration` table.** Semantically cleaner, but `op`
  authorship then can't FK to it; storing an integration id in `op.deviceId`
  needs the FK relaxed to a plain column, which on SQLite means a full `op`
  table rebuild migration, plus reducer/attribution changes to treat author
  as device|integration|null. More churn against a load-bearing table.

### Token model

- Format `bins_<prefix>_<secret>` (prefix stored plaintext for identification
  in the admin UI; only `sha256(full token)` stored, reusing `device.
  tokenHash`). Shown ONCE at creation. `scope ∈ {read, write}` (write implies
  read). `lastSeenAt` touched hourly like devices. Revoke = delete row.
- Read tokens: safe for client embedding. Write tokens: documented
  server-side-only.

### Read surface — versioned REST over materialized state

Prefix `/api/v1/` (a public contract deserves versioning; the sync protocol
stays internal-shaped). Group derived from the token, never a param:

- `GET /api/v1/bins` (+ `?location=`) — list w/ name, primary-photo blob sha,
  location, updatedAt.
- `GET /api/v1/bins/:id` — one bin + entries.
- `GET /api/v1/locations` — list.
- Photos: existing `/api/blobs/:sha` already gates on the bearer — read tokens
  pass. Primary photo stays DERIVED.

### Write surface (write scope only)

- Reuse `POST /api/sync/push` — an integration pushes ops like a device; the
  handler already stamps `ctx.deviceId` as author (= the integration under A).
  This is the op-shape write path for free.
- OPTIONAL later sugar: `POST /api/v1/bins/:id/notes` etc. that build the op
  server-side via the `lib/actions.ts` equivalents. Defer unless needed.

### Sync access (both scopes read via pull; push needs write)

- `GET /api/sync/pull` open to read+write tokens (build a replica).
- `POST /api/sync/push` gated on `scope === "write"`.

### CORS (for browser consumers)

- Per-integration `allowedOrigins` (JSON array). Echo
  `Access-Control-Allow-Origin` only on a matching request Origin; handle
  OPTIONS preflight. Applies to `/api/v1/*`, `/api/blobs/*`, `/api/sync/pull`.
  Wildcard `*` permitted only for `read` scope, and only if explicitly set.

### Admin surface + UI

- `POST /api/admin/integrations` (list), `.../integrations/create`
  `{ label, scope, allowedOrigins? }` → returns token ONCE,
  `.../integrations/revoke` `{ integrationId }`. All behind existing
  `requireAdmin` (member token + admin password).
- Admin page gains an "Integrations / API tokens" section: create (label,
  scope, origins), list (prefix + scope + lastSeen + revoke), one-time reveal
  with copy. Human device list filters out `kind = "integration"`.

Non-goals (match project posture): rate limiting beyond trivial, OAuth flows,
per-bin/per-field ACLs (scope is group-wide read or write), token expiry
(revoke instead). Tenant-agnostic: all generic, nothing operator-specific.

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
- [x] **Photo renditions + cache policy** (2026-07-06, user request) — every
  capture now makes THREE content-addressed blobs: thumb (320px, synced,
  kept locally forever), display (1600px — the op's canonical `hash`,
  unchanged), original (native res, only when the source beats 1600px;
  EXIF-free re-encode like everything else). `entry.addPhoto` payload gains
  optional thumbHash/originalHash; BinState gains derived primaryThumbHash;
  migration 0003. Upload order thumb→display→original (originals DEFERRED
  behind everything visible; their bytes drop locally once the server
  confirms). Local cache policy (`prunePhotoCache` after each sync cycle):
  thumbs forever, display bytes kept while primary-of-some-bin OR viewed
  within the per-device RETENTION window — user-configurable in Settings
  ("Keep photos offline": 1 week / 1 month / Forever; default 1 month;
  "Forever" for off-grid event weeks — user request 2026-07-06), else
  evicted (refetch on demand; never touches pending). Originals always drop
  after upload regardless (nothing displays them). PREFETCH (user request
  2026-07-06): Settings "Download all photos now" (`prefetchAllPhotos`)
  fetches every missing thumb+display rendition (batches of 4, progress in
  the button, skips originals/deleted entries) — the "leaving cell coverage"
  button, best paired with Forever retention.
  Dexie v2 migrates old blob rows. NOTE: nothing displays originals yet —
  archival for future zoom/AI use.
- [x] **Sticker-only entry, landing page, first-boot setup, admin page**
  (2026-07-06, user request) — access-code form removed from visible UI
  (unlinked `/join` keeps it working); branded landing (`/api/landing`,
  migration 0002 adds landing_title/landing_subtitle/admin_password_hash);
  `/setup` first-boot wizard (creates group + auto-joins operator; replaces
  BOOTSTRAP_* envs); `/admin` page: config/branding, code+password rotation,
  paste-import of pre-existing stickers, device revocation. 21 API tests.
  Limitation (documented in api/landing.ts): multi-group deploys serve the
  FIRST group's landing branding — one origin can't know the group.
- [x] **Auth recovery + install nudge** (2026-07-06, user request) — a 401
  during sync sets the `authDead` meta flag (cleared by the next good cycle):
  SyncBadge turns red "signed out", settings shows a sign-back-in card that
  re-joins via access code WITHOUT touching local data. `lib/auth.ts`
  signBackIn reuses the old deviceId when its row was deleted (authorship
  continuity — API-tested) and REFUSES a code for a different group (would
  push this group's outbox into another tenant). Install nudge: `lib/install`
  captures `beforeinstallprompt` early; one-time toast (`InstallHint`) +
  settings card (native prompt on Chromium, Share→Add-to-Home-Screen text on
  iOS), all hidden when already standalone.
- [x] **Auto-scan mode** (2026-07-06, user request) — the primary usage mode:
  the root camera never leaves the screen. Scanning an active bin makes it
  "current": its contents/history peek up over the camera (`BinPeek`,
  read-only; header links to the full page) and a pinned "Capture contents
  of #N" button shoots straight off the live viewfinder (no navigation).
  Detection keeps running, so a different box's QR in frame auto-switches;
  the SAME box never re-pops a peek the user collapsed. Current bin persists
  in meta (`currentBin`) across visits, restored collapsed. Recent-bin chips
  set the current bin instead of navigating. Unclaimed / not-in-replica bins
  still navigate to `/:binId` (claim flow / sync dead-end need the page).
- [x] **Per-bin secret codes** (2026-07-06) — full spec implemented (see spec
  section incl. as-built deviations): schema+migration 0001, allocate embeds
  codes in ops, `/api/auth/join-by-bin`, scanner keeps `?CODE` in the URL,
  sticker-URL FirstRun gate (name-only join + access-code fallback), print
  page QR/caption/code text. Tests: reducer claim-before-allocate convergence
  + API join-by-bin suite (14 pass).
- [x] Phase 3 (PWA shell) — DONE 2026-07-06. vite-plugin-pwa: manifest
  (standalone, portrait, theme #242424, icons incl. maskable — generated by
  `scripts/generate-icons.ts` (sharp) into `public/`), Workbox precache +
  navigateFallback (denylist `/api/`), CacheFirst `blobs` cache for
  `/api/blobs/{sha256}`, NetworkOnly `/api/*`, update prompt via
  `PwaUpdatePrompt` toast (`registerType: "prompt"`, NEVER auto-reload).
  Registration + head links are hand-rolled in root.tsx (`injectRegister:
  false`) because SPA-mode index.html is React-prerendered, not vite HTML.
- [x] Publishability sweep (2026-07-06) — scrubbed all tenant/host strings
  from tracked files (`.env.example`, deploy.yml, CLAUDE.md, comments,
  README, this plan); operator specifics moved to untracked `plans/local.md`.
- [x] **Category labels + weight** (2026-07-06, user request) — many-to-many
  category labels ("booze", "soda", "liquid", "kitchen", "shade"…) so boxes of
  a kind group together, plus an optional per-box weight. Design decisions:
  labels are group-defined rows driven by `label.upsert`/`label.archive` (same
  op-shape as locations; carry an optional Mantine `color`). MEMBERSHIP is LWW
  *per label*: `bin.setLabel {labelId, present}` folds into `fieldClocks` under
  `label:<id>` keys, and the bin's `labelIds` is the derived SORTED present set
  — so concurrent toggles of different labels never clobber each other, and the
  sorted array stays order-independent (convergence-tested). No new StateStore
  membership table; only a `label` definition table + `bin.label_ids`/
  `bin.weight_grams` columns (additive migration 0004). Weight rides the
  existing `binFieldsSchema` LWW scalar path, stored canonically in GRAMS (UI
  enters lb/kg per-device pref; `app/lib/labels.ts`). Dexie v3 adds a `labels`
  table + a multiEntry `*labelIds` index (indexed "all boxes tagged X"). UI:
  LabelChips (reusable multi-select + create), LabelSheet (bin-page categories
  + weight), WeightInput (lb/kg toggle), category chips/weight badge on the bin
  page + all-boxes + search rows, category filter chips on Search (browse a
  category), label management (+colors) in Settings, labels folded into the
  search index. Tests: 2 reducer convergence + 1 API round-trip (26 pass total).
  Built alongside a concurrent session (per user: waited for its commits first;
  slotted labels/weight in next to the renditions/retire work).
- [ ] Deploy — create GitHub repo (push master only — history already clean;
  see `plans/local.md`), register runner + host layout + reverse-proxy block
  per `plans/local.md`; then push & watch CI.
- [ ] Phase 4 — per-device unclaimed-ID reserve (offline new-box without
  sticker), print layout for real label stock, location reorder, retired-bin
  browsing, unarchive places UI.
- [ ] **Integration tokens + public API** (PROPOSED 2026-07-06, user request) —
  scoped (read/write) admin-minted API tokens for external apps we control;
  `/api/v1` query REST + op-log sync access; CORS for browser consumers. Full
  spec above. Blocked on the author-model decision (Open question 1).
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
- **RR7 SPA mode writes index.html AFTER the client bundle closes**, so
  vite-plugin-pwa's glob can't precache it. Fixed via
  `additionalManifestEntries: [{ url: "/index.html", revision: <build-time> }]`
  — if that entry is ever dropped, `createHandlerBoundToURL("/index.html")`
  throws at SW runtime and offline boot breaks silently.
- **zxing-wasm fetches its .wasm from a CDN by default** — useless offline.
  Self-hosted: `import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"`
  + `prepareZXingModule({ overrides: { locateFile } })` in scanner.tsx; the
  hashed asset is precached (`wasm` in globPatterns, 5 MB size cap).
- Windows dev environment: TCP ports 2980–3079 sit in a Hyper-V excluded
  range, so `bun run dev` port-hunts past 3080. Environment quirk, not app.

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

## Open questions for the user

(none open — see the integration-tokens spec's decided items above.)
