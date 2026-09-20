# bins — warehouse-instance features (second batch, 2026-09-19)

Companion to `plans/bins.md` (main plan) and `plans/multi-instance.md`
(the first batch: OPEN_ACCESS, label rendering, structured locations model).
This plan covers the operator's second round of requests after first real
use of a warehouse-style instance. Operator-specific details (shelf letters,
hosts, printer) live in the untracked `plans/tsl.local.md`.

## Goal

Make a warehouse-style deployment pleasant for its actual workflow:
a box gets filled at a desk, described once, given a printed label with a
line drawing, and put in a known slot on a known shelf, and anyone can see
the wall of shelves with every box in its real position.

## Requests, restated (2026-09-19)

1. Box numbers are optional. The event-style deployment uses them; the
   warehouse one should use opaque ids hidden from users. The first box on
   a fresh database being "#10" is what prompted this.
2. More size icons. Sizes are S (pencil-case sized), M (about 2.5 reams of
   paper stacked), L (a standard banker's box). No XL.
3. "External label" no longer makes sense on either deployment.
4. A "fill level" field on boxes.
5. Shelves: where is the shape defined, and a "virtual shelf" view showing
   every box in its real position. Later, a top-down warehouse map.
6. The new-box screen should work like the operator's label-generator app:
   title, subtext, generated line art from the title, reference pictures,
   consistent typography, print.

## What exists today (surveyed 2026-09-19, file:line in the survey notes)

- **Ids** are integers from one global per-database sequence starting at 10
  (`api/allocate.ts:21-26`, single digits reserved for test noise). Every
  layer assumes integers: op schema `binId` (`shared/ops.ts:28`), reducer,
  Dexie keys, route `/:binId` (`/^\d{1,9}$/`), QR scan parser
  (`app/lib/format.ts:38-46`), join-by-sticker auth, v1 API.
  `BOX_NUMBERS=internal` is presentation-only and only two components honour
  it; the `#id` still leaks in about fifteen places (detail pane, peek, claim
  panel, edit sheets, notifications, labels of unnamed boxes, the URL).
- **Sizes** are admin-defined rows (`boxSize.upsert`) with name + optional
  L×W×H and NO icon field. The new-box claim panel (`ClaimBin.tsx`) still
  uses a hardcoded S/M/L/XL segmented control and writes legacy `sizeClass`;
  only the edit sheet uses the defined sizes. A fresh group has zero sizes.
- **External label** is a free-text "what's written on the outside" field
  (`externalLabel`): inputs in ClaimBin, EditBoxSheet, the `/bins` edit
  sheet, the suggestion field list; displayed as a badge; boosted in search.
- **No fill-level** or fullness field of any kind on a bin.
- **Locations**: a place has `name, parentId, cols, rows, sortOrder,
  archived`; a bin has `locationId + slot` OR `locationName` under one LWW
  clock. Slots are integers 1..cols×rows in reading order. Admin
  `ShelfBuilder` defines places one at a time with a uniform grid. **No UI
  ever sets `locationId`/`slot`** (the picker is name-only), nothing
  resolves an id back to a name for display, and there is no view that draws
  boxes on a shelf. Per-row varying capacity is not representable in one
  place, but a shelf-per-row decomposition (bay "D" → shelves "D0".."D5",
  each with its own grid) is, and matches how people name shelves anyway.
- **Labels**: bins renders the label itself (satori + sharp, 4×6 default)
  and POSTs a PNG to `LABEL_PRINT_URL`. Input is only `binId`; title comes
  from the box name, no subtitle, no art instructions, no reference images,
  model fixed by env, art cached by model+prompt so it can never be
  regenerated, preview is a blocking server round-trip. The operator's
  label-generator app has: title, multi-line subtitle, additional art
  instructions, up to 5 reference images (downscaled to 512 px as style
  hints, sent as Gemini `inlineData`), Lite/Flash/Pro model choice with a
  cost badge and live balance, a never-blocking generate queue (each click is
  another candidate), a recent-images tray with re-prompt, and a free live
  layout preview before spending anything. Its art prompt is near-identical
  to bins' own.

## Decisions already made (don't re-ask)

- Ids are never reused and stay a monotonic integer sequence internally
  (`plans/multi-instance.md` work item 7). Whatever is shown to users or put
  in a URL is a presentation/handle question, not a primary-key change.
- Sticker parsing is additive forever: every historical URL form keeps
  scanning (`plans/multi-instance.md` work item 5).
- Slots are coordinates on the bin, not child rows per slot.
- Label art generation lives in bins (2026-08-03); the print server is a
  dumb `POST image/png` target, and the print server's own agent builds that
  endpoint, not this repo.
- Places are data authored in-app; nothing site-specific lands in tracked
  files.

## Design

### 1. Opaque box handles (pending the operator's choice, see questions)

Recommended: keep the integer id as the primary key and add a per-box
**public handle**, a UUID minted at allocation (`bin.allocate` payload gains
`handle`; column `bin.handle`, unique; Dexie index). On `BOX_NUMBERS=internal`
deployments the app's URLs, QR codes and printed labels use `/b/<handle>`
and the integer never appears anywhere. On public-number deployments nothing
changes. The route and scan parser accept BOTH forms on every deployment
(additive), and join-by-sticker / v1 API accept a handle wherever they accept
an id. QR density: a 36-char UUID after a ~30-char origin is well within
4×6-label comfort; uppercase hex keeps QR alphanumeric mode.

Also, regardless of the choice: make `internal` actually hide the number in
every one of the leak sites listed above, and title unnamed boxes on labels
as "Untitled box" rather than "Box 10".

### 2. Size icons, and the claim panel uses defined sizes

- `boxSize.upsert` payload gains optional `icon` (a key into a curated set).
  Reducer state, table column, Dexie: additive, nullable.
- A small in-repo SVG icon set drawn for relative size (pencil case, paper
  stack, banker's box, tote, crate, envelope, tube, bag, drawer, generic
  box). Admin picks one per size; the size picker, badges and the wall view
  use it.
- `ClaimBin` drops the hardcoded S/M/L/XL and uses `useBoxSizes()` with the
  same fallback the edit sheet has. Admin size manager gets a one-tap "start
  with S / M / L" seed (names + suggested dimensions, editable).

### 3. External label: remove from the UI

Remove the inputs (ClaimBin, EditBoxSheet, `/bins` edit sheet), drop it from
the suggestion field list and search boost. Keep the op/DB field so historic
ops still parse, and keep rendering the badge when a legacy value is
non-empty so nothing typed on the event deployment silently disappears.

### 4. Fill level

New bin field `fillLevel: number | null` (integer percent 0..100, stored as
percent so the scale can get finer later; the UI offers five steps: empty,
¼, ½, ¾, full). Set through `bin.claim` / `bin.setFields` like weight
(member-editable directly, not suggestion-gated: fullness changes with use).
Own LWW clock key. Shown as a small bar on the bin page, detail pane, list
row and wall-view cell. Reducer test added.

### 5. Shelves: bulk-built bays, slot placement, and the wall view

Model stays: a **bay** is a place; its **shelves** are child places with
grids; a box holds `locationId + slot`. Two additive fields on a place:
`span` (vertical height units for rendering, default 1, for a double-tall
bottom shelf) and nothing else; vertical order within a bay is `sortOrder`.

- **Bay builder** in admin: name (e.g. "D"), shelf numbers from..to (0..5),
  per-shelf grid rows (across × stacked, or "no grid" for bulk shelves),
  with a "same as above" default so a bay is a few taps. "Duplicate bay
  as…" to stamp D onto E..L. Generates the parent + children as ordinary
  `location.upsert` ops.
- **Placement**: the location sheet gains a structured path: pick a bay →
  shelf → tap a slot in its grid (occupied slots show the box). Writes
  `{ locationId, slot, locationName: null }`. Freeform stays.
- **Display**: everywhere `locationName` is shown, resolve
  `locationId` → "D1 · slot 5" (path label from `shared/locations.ts`).
  Search indexes the resolved label. v1 API exposes `locationId`/`slot`.
- **Wall view** (`/shelves`): pick a top-level place; render its bays side by
  side in `sortOrder`, each bay's shelves stacked bottom-up, each shelf's
  grid as cells with the box's thumbnail/name and size icon; tap → peek.
  Over-capacity and unplaced boxes ("on the floor") listed beside it. This
  is the "virtual shelf". The top-down map is a later layer over the same
  data (bays get x/y later; not now).

### 6. Label-first new box

The new-box flow becomes one screen modelled on the label generator:

- Fields: **Title** (box name), **Subtext** (new bin field `description`,
  multi-line, ≤500, printed under the title and shown in the app), **Size**
  (with icons), **Categories**, **Fill level**, **Art instructions** (new bin
  field `artPrompt`, kept so a reprint regenerates consistently),
  **Reference pictures** (up to 5, camera or library, downscaled client-side
  to ≤512 px, sent with the generation, NOT stored on the box), **Model**
  (Lite / Flash / Pro from the server's pricing table, cost shown).
- **Free live preview** of the layout (title, subtext, QR, dashed art box)
  rendered client-side before anything is spent; server preview only once
  art exists.
- **Generate** is never blocked: each tap is another candidate; the chosen
  one is saved as a new entry kind `label_art` (content-addressed blob,
  synced like photos, latest wins) so reprints are free and other devices
  see the same label. Cache key gains a nonce so "another one" works.
- **Print** posts the finished PNG as today. Preview and art work without a
  printer configured; the Print button appears only with `LABEL_PRINT_URL`.
- Server: `/api/admin/bins/label` and `/preview` accept `title`, `lines`,
  `artPrompt`, `references[]`, `model`; art request gains `references` and
  `instructions`; prompt text aligned with the label generator's (explicit
  line-width guidance, the "references are style only" line).

## Plan / steps (all built 2026-09-19; see progress log)

1. Decisions from the operator: done.
2. Quick wins: done (`b9774ba`, `26f57d8`).
3. Box handles: done (`5325db0` model, `d761192` UI/API).
4. Shelves: done (`45378b2`).
5. Label-first new box: done (studio commit).
6. **← current** Per-instance env on the warehouse deployment (ops,
   per-change authorization): `LABEL_ART_API_KEY`, `LABEL_ART_BUDGET_USD`,
   optionally `LABEL_ART_MODEL`; `LABEL_PRINT_URL` once the print server
   accepts `POST image/png`. Then bump the ops pin to the built image.

## Findings / gotchas

- "We don't have an XL" comes from the claim panel's hardcoded S/M/L/XL, not
  from defined sizes: a fresh group has none, and the panel never reads them.
- `BOX_NUMBERS=internal` hides the number in exactly two components; the
  first box reading "#10" is the id reserved-range rule, not a bug.
- The label art cache is keyed by model+prompt with no nonce, so the same
  box can never get a different drawing today.
- The print server has no image-accepting endpoint yet (only its own 1-bpp
  gzip format); bins already POSTs `image/png`, so that side needs a small
  route before anything prints.

## Decisions from the operator (2026-09-19)

- **Opaque UUID handles** for the warehouse instance (design §1 as written).
- **Build the whole batch**, order at the implementer's discretion
  (dependency order: shared model → server → client).
- **The printed sticker never carries the shelf/section** (boxes move; the
  app is the live truth). Title, subtext, line art, QR only. This replaces
  the event deployment's pre-printed sticker sheets: a sticker is generated
  on the fly for the box being made and printed immediately.
- **Eventual ARKit tool** walks the aisle, recognises boxes and updates their
  locations automatically. Already anticipated in `plans/multi-instance.md`
  ("continuous scanning"): a native app writing through the integration API,
  ideally as append-only sightings. Nothing here may foreclose it: keep
  `bin.setLocation` as the authoritative set, and keep the handle scannable
  from the QR so a recogniser can identify boxes without OCR.

## Open questions for the operator

(none open)

## Progress log

- [x] Surveyed ids, sizes/icons/external label, locations, both label
      pipelines (2026-09-19).
- [x] Plan written; decisions received (UUID handles; all at once; no shelf
      on stickers).
- [x] Model (`5325db0`): handle, fillLevel, description, artPrompt,
      labelArtHash on bins; span on places; icon on sizes; Dexie v10;
      migration 0015. Also fixed the server never persisting
      locationId/slot.
- [x] Handles + number hiding (`d761192`): `/b/<handle>` route, scan parser,
      join-by-sticker, v1, labels, sticker export; every `#id` leak routed
      through `app/lib/boxRef.ts`.
- [x] Fill level + subtext, external-label inputs removed (`b9774ba`).
- [x] Size icons + claim panel uses defined sizes + S/M/L starter (`26f57d8`).
- [x] Shelves (`45378b2`): bay builder, slot picker in the location sheet,
      resolved display everywhere, search over breadcrumbs, `/shelves` wall.
- [x] Label-first studio: `LabelStudio` (new + edit modes) with free live
      preview, art instructions, ≤5 reference pictures (512 px JPEG hints),
      Lite/Flash/Pro with cost + monthly spend, never-blocking candidates,
      chosen art saved on the box and stored as a group blob;
      `POST /api/admin/bins/art`, `/api/admin/art/status`; the label
      renderer prints the saved art and the subtext; location never printed.
- [x] Checks: typecheck, lint, 166 tests green at each commit.
- [x] **Browser-verified 2026-09-19 on the dev server** (public-number
      deployment, no art key): New box → studio → title/subtext/size/fill →
      Save box → box page shows all of it; admin bay builder D0–D5 with
      3×1 / 3×2 / 3×4 grids (verified in SQLite); location sheet drill
      D → D1 slot 2 → box page reads "D › D1 · slot 2"; `/shelves` draws
      D5…D0 top-down with the box in its slot and the unplaced list.
      NOT driven in a browser: art generation (needs a provider key; covered
      by the API test with a stubbed provider) and printing (no printer).
- [x] Step 6, deployed 2026-09-20 (ops `43bd06d`, run 35481069522): the
      warehouse stack runs `b34f07d`, verified live (`/_version`, landing
      `boxNumbers:internal`, LAN 200, edge 403, socket present after the
      recreate). Art env is wired with the key left empty (drawings off until
      the secret is set); `LABEL_PRINT_URL` still waits on the print server's
      `POST image/png` endpoint (that repo's agent).

## Things not to do

- Don't change the bin primary key type; don't touch the reducer's id type.
- Don't remove the `externalLabel` field from ops or the DB; only the UI.
- Don't store reference pictures on the box; they are transient style hints.
- Don't generate one location row per slot.
