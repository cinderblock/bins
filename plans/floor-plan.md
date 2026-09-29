# Floor plan — laying out many walls in one space

Companion to `plans/bins.md` (the living plan), `plans/warehouse-features.md`
(which built the single-wall "virtual shelf" and deferred this: *"The
top-down map is a later layer over the same data (bays get x/y later; not
now)"*) and `plans/wide-screens-and-direct-edits.md` (the hover-edit idiom
this reuses).

## Goal

Operator request, 2026-09-28:

> We need a more visual way to layout the shelves high level. A single wall
> is mostly solved... but if I have multiple walls of boxes, i need more
> controls to show how those are laid out in a potentially arbitrarily
> shaped space.

The wall view (`/shelves`) answers "where on this wall is it". It cannot
answer "where in the room is that wall": today multiple walls are separate
top-level places behind a dropdown, with no spatial relationship at all. The
floor plan is a top-down drawing of a space. It shows the room's outline,
where each wall of shelving stands and which way it faces, and tapping a
wall opens the elevation view that already exists.

## Environment / context

- Repo `C:\Users\camer\git\Personal Projects\bins`, branch `master`.
- Places today (`shared/ops.ts` `location.upsert`, `shared/reducer.ts`
  `LocationState`): `name, sortOrder, parentId, cols, rows, span, code,
  archived`. `upsert` ASSIGNS every field under one `value` clock, and
  `archived` has its own clock.
- Wall view (`app/routes/shelves.tsx`): picks a top-level place ("root")
  from a dropdown, then draws root → bays (columns) → shelves (stacked
  bottom-up) → slots. There is no position anywhere in the model.
- Shape descriptors: `shared/locations.ts` (`locationGeometry`, cycle-safe
  walks). Client helpers: `app/lib/places.ts` (`usePlaceMap`, `childrenOf`,
  `useOccupancy`).
- Latest migration `0019`; Dexie is at `version(9)` or later (check
  `app/lib/db.ts` before adding a version).
- Other sessions work in this tree. At the start of this work
  `app/routes/shelves.tsx` carried another session's uncommitted change
  (moving "Add a place" into the empty state). Keep the floor plan in its
  own files and touch `shelves.tsx` minimally.

## Decisions already made (don't re-ask)

- **Positions are their own op with their own clock.** A new
  `location.setLayout` op, not new fields on `location.upsert`. Why: upsert
  assigns every field, so (a) renaming a shelf would compete with someone
  dragging it on the map, and (b) any client built before this change would
  WIPE positions on every place edit. A separate clock (like `archived`)
  avoids both. Dragging writes one op when the drag ends, never one per
  frame.
- **A position records which parent it was placed in.** Positions are
  relative to the parent's plan. If a place is later moved to another
  parent, its old coordinates mean nothing in the new frame. The reader
  treats a layout whose `parentId` no longer matches as "not placed yet",
  which puts the place back in the tray. The check happens when reading, so
  the reducer stays order-independent.
- **The room outline belongs to the space, as its own op too.**
  `location.setPlan` on the space: an outline polygon (plus landmarks, if
  those are wanted) as one LWW value. Two admins editing the outline at
  once is rare, and a polygon has no meaningful per-vertex merge.
- **The map sits above the elevation view and does not replace it.** The
  map is the top level of `/shelves` once a space has a plan. Tapping a wall
  on the map opens that wall's existing elevation. The dropdown stays for
  spaces that have no plan yet.
- **SVG, with a viewBox in world units.** The browser handles zoom and pan
  as viewBox changes, hit-testing, and crisp text. Canvas would mean
  rebuilding all of that, and the scene is at most dozens of rectangles.
- **Editing follows the existing idiom.** Admin-only, desktop-first
  (drag / rotate / resize), with every action also reachable without
  hover, per `plans/wide-screens-and-direct-edits.md`.
- **Tenant-agnostic.** No site's dimensions or names in tracked files.

### Operator answers (2026-09-28)

1. **What goes on the map: walls, plus loose bays and zones.** A wall (a
   run of bays) moves as one unit. A lone bay, or an open floor zone ("the
   pallet area"), can also sit directly in a space.
2. **Scale: "Either?"** Both are supported, chosen per space.
   Coordinates are always stored in millimetres. A space marked "drawn to
   scale" shows measurements and accepts typed lengths in the device's
   unit. An unscaled space is roughed in on a plain snap grid (one square
   is 500 mm underneath) and shows no numbers. Switching a space between
   the two changes only what is displayed.
3. **Landmarks: yes.** Doors, pillars, fixtures (workbench, desk, fridge)
   and free text labels. They live in the space's plan. They are never
   places, so the location picker never offers one.
4. **Viewer features: all four.** (a) Show where a box is, from the box
   page, a search result or a scan. (b) Fullness at a glance. (c) Category
   tint. (d) Scanning a shelf sticker in put-away shows that shelf on the
   map.

## Model (as decided)

Hierarchy, defined by what a place CONTAINS. Nothing new is stored to say
what kind a place is, so existing data stays valid unchanged. The kind is
derived from the height of the subtree:

- **shelf** (height 0): has a grid, or holds boxes directly.
- **bay** (height 1): its children are shelves.
- **wall** (height 2): its children are bays.
- **space**: has a `plan`, or has height 3 or more. Its children are map
  items, whatever they are.

A map item is drawn according to its own kind:

- **wall**: a rectangle split along its length into bay segments, with the
  front edge marked.
- **bay**: one segment.
- **shelf or leaf**: a dashed "zone" showing a box count.
- **nested space**: a zone. Tapping it drills into that space's map.

Adopting the map on existing data means creating a space and moving the
old root inside it (the "Inside" picker already does this). Alternatively,
put a plan directly on the old root, which places its bays one by one. Both
fall out of the same rule.

**`location.setLayout`** (on the child, `fieldClocks.layout`):
`{ locationId, layout: { parentId, x, y, rotation, width, depth } | null }`.

- The position is the centre, in the parent's frame, in mm.
- `rotation` is in degrees, 0–360. At 0 the front faces +y, i.e. down the
  page, so a viewer standing below the wall sees its bays left to right as
  +x. That matches the elevation.
- `null` means "remove from the plan", which sends the item back to the
  tray.
- A bay inside a wall may carry a layout whose `parentId` is the wall. Only
  its `width` is read, as the bay's share of the wall's length (the
  operator's bays A–C are wider than D–L). With no explicit width, bays
  share the length in proportion to their widest shelf's `cols`.

**`location.setPlan`** (on the space, `fieldClocks.plan`):
`{ locationId, plan: { scaled, outline: [x,y][], landmarks: Landmark[] } | null }`.
`Landmark = { id, kind: door|pillar|fixture|text, label, x, y, rotation,
width, depth }`. The whole plan is one LWW value, per the earlier decision.

**Navigation.** `/shelves?place=<id>` shows a map if that place is a
space, otherwise its elevation. Adding `&find=<binId>` highlights a box.

- Bare `/shelves` opens the first top-level space, falling back to the
  first wall, so today's behaviour is unchanged until a plan exists.
- The header selector lists every space and wall by breadcrumb.
- A wall inside a space shows a breadcrumb back to the map.
- Tapping a wall on the map pushes history, so Back returns to the map.

**Editing** (unlocked admins; a pencil in the map's own corner toolbar, not
the page header, following the "rare actions don't go in headers" rule):

- A tray of children not yet placed. Tap one to drop it at the centre of
  the view with a sensible default size.
- Select to get handles: drag the body, rotate (15° snap; Alt for free),
  resize the ends and the depth.
- An inspector with numeric fields, so every edit is possible without
  hover or drag. It also has rotate 90°, "remove from plan", "edit place"
  and "open wall", plus per-bay widths for a wall.
- Arrow keys nudge, R rotates, Delete removes, Esc deselects. Ctrl+Z undoes
  within the editing session: every write records the value it replaced.
- Outline: start from a rectangle that fits what is placed, drag vertices,
  drag an edge's midpoint to insert a vertex, and delete a selected vertex.
  Snaps to the grid and to right angles with neighbouring vertices.
- Landmarks are added from a small menu and behave like items.

**Viewer.**

- Colour-by: Fullness (a sequential ramp over occupied slots ÷ capacity),
  Category (the dominant label's colour in that bay), or None.
- `?find=<box>` (or `?at=<place>` for a scanned shelf) pulses the segment
  holding it and shows a caption with "Open the shelves", which opens the
  elevation with that slot (or shelf) ringed and scrolled into view.
- `FloorPlanMini`, a small read-only map with one highlight, appears on the
  box page, the desk-mode detail pane, the scanner peek and the put-away
  bar. It renders NOTHING unless the thing is actually on a map. Tapping it
  opens the full map pointing at the same thing. In the thumbnail only bay
  letters are drawn — names and counts collide at that size.
- On an unscaled space the inspector counts grid squares (1 square =
  500 mm) instead of showing lengths.

**Where each piece lives.**

- `shared/floorplan.ts` — pure geometry: kind derivation, `activeLayout`,
  `baySegments`, transforms, snapping, `sanitize*`, outline helpers,
  `mapTarget`. Tested in `shared/floorplan.test.ts`.
- `app/lib/floorplan.ts` — `usePlanData` (places + per-place fullness and
  dominant category), `buildScene` (drafts applied), the ramp.
- `app/lib/lengths.ts` — ft/in and m formatting and parsing, per-device
  unit, snap and grid steps. Tested.
- `app/components/FloorPlanSvg.tsx` — the drawing: view state, pan / zoom /
  pinch, gesture classification into tap / drag / pan, handles.
- `app/components/FloorPlanView.tsx` — viewer + editor: drafts, undo/redo,
  keyboard, tray, inspectors, legend, focus card, pointed-at caption.
- `app/components/FloorPlanMini.tsx`, `LengthField.tsx`,
  `NewSpaceSheet.tsx` ("lay these walls out on a floor plan").
- `PlaceEditSheet` gained "Give it a floor plan" / "Open its floor plan" /
  "Remove floor plan" (two-tap).
- `routes/shelves.tsx` — `?place=`, `?find=`, `?at=`; selector grouped into
  floor plans and walls; breadcrumb from a wall back to its map; the
  "N walls, nothing says where they stand" offer (admins, no space yet,
  two or more top-level walls).

## Plan / steps

1. [x] Operator answers the open questions.
2. [x] Ops + reducer: `location.setLayout`, `location.setPlan`, with their
       own clocks. Reducer convergence tests (order-independence,
       re-application, layout before upsert, layout after reparent).
3. [x] Schema: migration 0020 (additive columns on `location`), Dexie
       v14 backfill, store adapters, API round-trip test. Also: the AI
       catalog's diff tail now skips layout/plan ops (`SILENT_OPS`).
4. [x] `shared/floorplan.ts`: pure geometry. 21 unit tests.
5. [x] `FloorPlanSvg` (view): outline, walls with a facing marker, bay
       segments, fullness / category fill, labels, pan/zoom, tap → details.
6. [x] Editor: drag, rotate, resize, tray, outline editing with grid and
       right-angle snap, landmarks, inspector, keyboard, undo/redo.
7. [x] `/shelves` integration.
8. [x] Box → map on the box page, desk detail pane, scanner peek, put-away.
9. [x] Checks, browser verification at desk width, README, commit.
10. [ ] **Open:** verify at phone width and on a real touch device (pinch,
       two-finger pan, drag). See "Not verified" in the progress log.

## Findings / gotchas

- **Read the space from the view's OWN live query.** `FloorPlanView` first
  drew the space passed in by `/shelves`, which comes from a different
  `useLiveQuery` than the one drafts are retired against. The two update at
  different moments: the draft was retired as soon as the view's query
  agreed, the drawing then fell back to the caller's copy — still without
  the change — and the next edit was built on that. Found in a browser:
  "Draw the room's walls" then "Add a landmark" lost the outline. Fixed by
  resolving `data.byId.get(space.id)` inside the view.
- **Sanitize once, before drafting.** Drafts held raw drag values
  (`3657.5999999999995`) while the op carried the rounded one, so a draft
  never equalled the stored value and only retired on its timeout.
  `apply()` now sanitizes first and uses the same value for draft, undo
  record and op.
- **The admin check is async.** `useAdminPassword()` is undefined on the
  first render, so `useState(startEditing && unlocked)` was always false;
  "Create and arrange" landed on the map, not the editor. A one-shot
  effect opens the editor once `unlocked` arrives.
- **`setPointerCapture` throws for a pointer the browser doesn't consider
  active** (synthetic events, some pen edge cases). Wrapped; the gesture
  works without capture, just not past the map's edge.
- **The preview harness's wheel-to-scroll zooms the map.** Clicking a menu
  item that overlays the SVG sometimes left the map zoomed in — the
  automation scrolls with wheel events and the map's wheel handler zooms.
  Not an app bug; "Fit" restores it.

- **A schema-invalid op fails the WHOLE push with 400**, not a per-op
  `rejected` entry (`api/sync.ts` parses the batch as one). So an
  out-of-range layout from a buggy client blocks that device's outbox. The
  client must normalise rotation into [0, 360) and clamp lengths before
  writing — the map's writers do, via `shared/floorplan.ts`.
- **Every drag would have been an AI-tail line.** The assistant's prompt
  appends ops since its snapshot; `api/ai/catalog.ts` now filters
  `location.setLayout`/`setPlan` out (`SILENT_OPS`), since where a wall
  stands says nothing about where a box is.
- **Schema files import shared code by relative path** (`../../shared/ops`)
  — `api/runtime-imports.test.ts` enforces it; the container ships without
  tsconfig, so `@shared/*` would crash-loop the server.
- **`bun run lint` on this Windows checkout flags every CRLF working-tree
  file as a format error** (`␍` in the diff). The index is LF and CI sees
  LF; lint the files you changed (`biome check <files>`) to get a real
  answer. Pre-existing and unrelated: three `organizeImports` and three
  `suppressions/unused` findings in files this work never touched.

## Things not to do

- Don't put positions on `location.upsert`. See the first decision above.
- Don't write an op per drag frame. Write one when the drag ends.
- Don't let a stale position from an old parent draw in the new one.

## Progress log

- 2026-09-28: surveyed the model and wrote this plan; operator answered.
- 2026-09-28: data layer committed (`608d379`): ops, reducer, migration
  0020, Dexie v14, API round-trip test, AI tail filter.
- 2026-09-28: geometry, units, map, editor and every integration point
  built. `typecheck` clean, all tests pass (291), lint clean on every file
  touched. Driven in a browser at desk width against an isolated dev
  instance (ports 3180/3181, scratch db, seeded with three walls, 60
  boxes, four categories):
  - The "3 walls, nothing says where they stand" offer → Create and
    arrange → map opens in the editor with all three walls in the tray.
  - Placing each wall, dragging (snapped to 6″), quarter-turning, arrow
    nudges, Shift-nudge, two undos and a redo — all verified against the
    replica's stored layouts.
  - Room outline from a rectangle, a corner inserted by dragging an edge
    midpoint, a neighbouring corner snapping square; door and pillar
    landmarks alongside it.
  - Viewer: fullness shading and legend, category tint and legend, tap a
    bay → "Box wall › E · 18 of 39 slots used · Mostly tools" → Open the
    shelves → elevation with a "Warehouse floor plan › Box wall" way back.
  - Box page mini-map pulses the right bay; tapping it opens the full map
    pointing at the box; "Open the shelves" rings its slot in the
    elevation and scrolls to it. Desk-mode detail pane shows the same.
  - Place editor → "Give it a floor plan" on a plain place opens its
    (empty) plan in the editor.
- 2026-09-29 (deployed): bins `6c0c9fe`, image digest
  `sha256:c159a80e…0194d8`, pinned on BOTH deployments by user decision
  (ops `934ab04` warehouse, `fdb2e64` the other). Both `/_version` endpoints
  report `6c0c9fe`. The ops "Server Deploys" run was marked failed: on the
  warehouse host every stack including bins deployed, then the final Caddy
  step failed to pull its (unchanged) image — `TLS handshake timeout` to
  ghcr.io, a transient network error, not this change. Caddy kept running
  its existing container, so the site stayed up. Rollback for either is
  reverting its pin. Host-specific detail: `plans/local.md`.
- **Not verified:** phone width (the harness's resize times out here, as
  it did for the wide-screens work), real touch gestures (pinch, two-
  finger pan, touch drag — the automation can only synthesize single
  mouse-style pointers), and the scanner peek / put-away bar mini-maps
  (both need a live camera; they reuse the component verified on the box
  page).

## Open questions for the user

(none open. All four were answered 2026-09-28; see "Operator answers".)

Worth deciding later, not blocking:

1. Should the AI assistant learn the map ("the kitchen stuff is on the
   north wall by the door")? It currently ignores layout on purpose — see
   `SILENT_OPS`. *Recommendation: only if asked; it answers by shelf name
   already, and the map is one tap from any answer.*
