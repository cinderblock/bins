# Put-away mode, shelf stickers, and four warehouse fixes

## Goal

Four things the operator asked for on 2026-09-20, after using the warehouse
instance for real:

1. **Admin is unreachable.** "There seems to be no way to get to the admin
   interface that lets me set what kind of boxes exist." True: `/admin` is
   linked only from Settings, and Settings is linked only from the SCANNER
   header — which a `HOME_VIEW=browse` deployment never opens on.
2. **`/` should show the shelves view.**
3. **Archived boxes should be hidden from normal views, and there should be a
   delete for them.**
4. **Bulk "move box" is the wrong shape here.** Wanted instead: a put-away
   mode where scanning a box files it on a shelf — recent shelves as one-tap
   buttons, and shelf stickers scannable. The shelf stickers ARE ALREADY
   PRINTED and carry no URL prefix, just a random string, which the app must
   recognise.

## Environment / context

- Repo `cinderblock/bins`; the warehouse deployment is described in
  `plans/tsl.local.md` (untracked). It runs `OPEN_ACCESS=1`,
  `HOME_VIEW=browse`, `BOX_NUMBERS=internal`.
- Places (shelves) are `LocationState` (shared/reducer.ts), written by
  `location.upsert` ops; a box holds `locationId` + optional `slot`.
- The scanner is `app/routes/scanner.tsx`; its `useScanner` hook currently
  discards any QR that is not a bins box URL.

## Decisions already made (don't re-ask)

- **Shelf codes are opaque strings on the PLACE, not a URL scheme.** The
  stickers exist and cannot be reprinted, so the app adapts: a place gains
  `code`, and anything scanned that is not a box is looked up as a place
  code. Matching is case-insensitive on a trimmed value; if the string
  happens to be a URL, its last path segment is used. This works whatever
  the printed format turns out to be.
- **Uniqueness is advisory, not enforced.** The reducer cannot reject a
  duplicate without reading other rows, which would make it order-dependent
  and break convergence (same reasoning as location cycles, see
  shared/locations.ts). So: the UI warns when a code is already taken, and
  lookup is deterministic (lowest id wins) and reports the ambiguity.
- **Put-away keeps a CURRENT SHELF.** "Each scan prompts the shelf" would
  mean a prompt per box; a shelf that sticks until changed matches the real
  job (stand at a shelf, scan the boxes onto it). Scanning a box with no
  shelf set asks for one; after that every box goes to the current shelf
  with an undo toast. Scanning a shelf sticker switches shelves.
- **Delete is a tombstone op (`bin.delete`), not a purge.** The op log is
  the source of truth and replicas pull incrementally, so a row deleted on
  the server would simply never reach them — and re-applying the log would
  resurrect it. A fourth status `deleted` converges, and keeps the invariant
  that an id is NEVER reused, which is what makes a leftover sticker
  identifiable rather than dangerous. Admin-only, from the retired list.
- **Retired boxes leave every normal view**, including the admin's. They get
  their own toggle on the box list, which is where restore and delete live.
- **`HOME_VIEW=shelves`** is a third value of the existing deploy-time flag,
  not a new mechanism. The shelves view grows a home-aware header the way
  the box list already has one.

## Plan / steps

1. [x] Plan written.
2. [x] Model: `location.code`; `bin.delete` + `BinStatus "deleted"`;
       `homeView` gains `shelves`. Migration 0018 + Dexie v12.
3. [x] Server: `POST /api/admin/bins/delete`; config + landing.
4. [x] Client lib: `placeCodeFromScan`, `findPlaceByCode`, recent shelves
       (per device, Dexie meta — `app/lib/putaway.ts`).
5. [x] UI: Settings + admin reachable from the box list and shelves;
       `/` renders shelves; retired hidden behind a toggle with delete;
       put-away mode in the scanner; bind a sticker to a shelf.
6. [x] Tests: reducer (code rides and clears), places (lookup, duplicates,
       archived), format (sticker parsing), API (delete endpoint). 197 green.
7. [x] Build, browser-verify against the production bundle.
8. [ ] **CURRENT** — Ops (staged, shown, wait for yes): `HOME_VIEW: shelves`,
       pin bump.

## Findings / gotchas

- A union of object shapes does NOT protect a callback's argument: passing
  `{ locationId, name }` where `LocationSheet.place()` wanted
  `{ locationId, slot, label }` type-checked, because TypeScript allows an
  excess property that exists on SOME member of the union. It shipped a
  toast reading "Location: undefined". Caught in the browser, not by tsc.
- `useScanner` only reported values that parsed as a box. Put-away needs the
  RAW value, so the hook now reports every code it reads (with the parsed
  box target when there is one) and the caller decides. The duplicate
  suppressor keeps a foreign QR in frame from firing more than once per
  2.5 s.

## Progress log

- 2026-09-20: all four built and browser-verified against the production
  bundle (stubbed image provider, `HOME_VIEW=shelves`):
  - **admin reach** — the box list header now carries Settings always and
    Admin once unlocked, and the shelves view carries All boxes / Scan /
    Settings. Before this, a browse-home or shelves-home deployment could
    not reach `/admin` at all, so box sizes were unreachable.
  - **`/` is the wall** — `HOME_VIEW=shelves` renders the shelf view at the
    root, with no back arrow (back off the home screen leaves the app).
  - **retired** — retiring a box removes it from the list immediately; a
    "Retired (n)" toggle shows them, where Restore and a two-tap "Delete for
    good" live. Deleting leaves the list empty and the box's own page reads
    "This box was deleted", read-only, with no Label or edit affordances.
  - **put-away** — tapping a recent shelf sets "Filing boxes onto D › D3",
    then each box scanned files there with a `Tent stakes → D3` toast and a
    running count, no navigation. Recents reorder most-recent-first. The
    shelf view then shows D3 at 1/6.
  The camera itself can't run in the headless preview, so the shelf-STICKER
  half is covered by unit tests (parsing, lookup, duplicates, archived) and
  the box half was driven through the manual bin-number input, which goes
  through the same `onScan`.

- 2026-09-20 (follow-up): **every picker over a group vocabulary can now add
  to it inline.** The operator: "any dropdown that requires pre-made
  categories should have an inline way of quickly adding a new category."
  Category labels already had this; nothing else did. Now:
  - `SizePicker` ends with a "+ New size" card wherever admin is unlocked
    (the studio, the box page's edit sheet) — name, glyph, created and
    selected on the spot. Sizes are server-authored, so without an admin
    password the picker still only offers what exists, as before. Real
    dimensions stay in the admin manager, where there is room to be careful.
  - The place pickers — the box page's location sheet, the bulk-move sheet,
    the shelf builder's "Inside" parent, and the unknown-sticker sheet — all
    grew a "+ New place/shelf" through one shared `InlineCreate`. Places are
    ordinary client ops, so any member can make one; it lands at whatever
    level the sheet is showing, and is selected immediately.
  - `createPlace` (app/lib/places.ts) reuses a same-named sibling instead of
    making a second, for the same reason the label composer does.
  Verified against a production build: a new size created and selected from
  the box page; a new place created from the location sheet with the box
  landing on it; a new parent created and selected in the shelf builder; a
  new place created from bulk move with "Moved 1 box to Cold storage".

## Things not to do

- Don't reprint or re-encode the shelf stickers — they are already on the
  shelves. The app reads what is there.
- Don't make delete reuse an id, ever.
- Don't enforce code uniqueness in the reducer.
