# Wide screens, and editing things where you are looking at them

Companion to `plans/bins.md` (the living plan) and
`plans/putaway-and-admin-reach.md` (the previous round of "admin is
unreachable" work).

## Goal

Operator request, 2026-09-21, after living with the warehouse deployment:

1. **The UIs — especially the settings pages — need responsive layouts that
   work on wide screens.** Settings is a 480px column and Admin a 520px
   column; on a desk monitor that is one narrow ribbon down the middle of a
   very empty page, and every section is a scroll away from every other.
2. **Shelves and boxes should get little buttons on hover to edit directly.**
3. **More direct edits in general, for admins.** Stated plainly: *"I don't
   want to be chasing things in settings."*

(3) is the actual brief; (1) and (2) are how it shows up. The shape of the
fix is: the thing you are looking at is the thing you edit, and the editor
comes to you rather than you navigating to a settings page that owns it.

## Environment / context

- Repo `C:\Users\camer\git\Personal Projects\bins`, branch `master`.
- No CSS files exist in `app/` — everything is Mantine props and inline
  styles. `:hover` on a PARENT cannot be expressed inline, so the hover
  affordance needs real CSS. `app/root.tsx` already injects a constant
  stylesheet (`earlyColorSchemeCss`) into `<head>`; this follows that idiom
  rather than introducing CSS modules for three rules.
- Layout conventions live in `app/lib/ui.ts` (`PAGE_MAXW`, `PHONE_MEDIA`,
  `DESKTOP_MEDIA`, `TOUCH_MEDIA`, `TOUCH_TARGET`).

## Decisions already made (don't re-ask)

- **Masonry, not a grid.** Settings/admin cards have wildly different
  heights; a `SimpleGrid` would align rows and leave craters. CSS
  multi-column (`column-width`) with `break-inside: avoid` on each card
  gives a balanced masonry that collapses to one column on a phone with no
  media queries at all. `CardGrid` (`app/components/CardGrid.tsx`).
- **Hover affordances are a desktop ENHANCEMENT, never the only path.** Two
  classes, because tight overlays and roomy headers want different answers:
  - `HOVER_ACTIONS` — always visible on touch, revealed on hover on a
    fine-pointer device. For rows and headers that have room for an icon.
  - `HOVER_ONLY` — hidden entirely on touch. For controls that OVERLAY
    content (a box cell in a shelf grid is ~58px wide; a permanently
    visible icon cluster would cover the box's name on every phone). On
    touch the existing tap-through to the box page is the path.
  Reveal is `opacity`, not `display`, so nothing reflows on hover, and
  `:focus-within` reveals them for keyboard users.
- **No `title=` attributes, ever** (global rule): icons carry `aria-label`,
  and anything a sighted user needs to know is a visible label.
- **One place editor, reachable from everywhere a place is shown.**
  `PlaceEditSheet` is extracted from the top-of-card draft form that lived
  in `ShelfBuilder`. That form was itself a "chasing things" problem — on a
  wide multi-column layout, clicking Edit on row 40 scrolled the form out of
  sight. A sheet comes to you. Now used by the shelf builder, the shelves
  wall, and the Settings › Places card.
- **One box quick-edit, ditto.** `BoxQuickEdit` is extracted from the local
  `EditSheet` in `routes/bins.tsx` and reused on the shelves wall.
- **The quick-edit's location field became a real location picker.** It was
  a freeform `TextInput` writing `locationName`, which on a structured
  placement ("D3 · slot 5") would have silently thrown away the shelf and
  the slot the moment anyone typed in it. It now shows where the box is and
  opens the existing `LocationSheet` (places → shelves → slots, freeform
  still available). The two sheets never nest: opening the picker closes the
  quick-edit's own modal while keeping its draft state mounted.
- **Category labels can be renamed and recoloured.** They could not be, at
  all, anywhere — a typo in a category was permanent, and the only remedy
  was archive-and-recreate, which does not move the boxes.
- **Places and categories can be restored from Settings.** Archiving was a
  one-way door there; restore existed only in the admin shelf builder.

## Plan / steps

1. [x] Plan written.
2. [x] `app/lib/ui.ts`: `WIDE_MAXW`, `CARD_MINW`, `HOVER_PARENT`,
       `HOVER_ACTIONS`, `HOVER_ONLY`, `UI_CSS`; injected by `root.tsx`.
3. [x] `CardGrid` + `CardGridWide` (a section that spans every column —
       the shelf builder wants the room).
4. [x] `PlaceEditSheet` extracted from `ShelfBuilder`; builder now opens it
       from "Add a place" and from each row's Edit.
5. [x] `BoxQuickEdit` extracted from `routes/bins.tsx`, location field
       replaced by the real picker.
6. [x] Settings: wide layout, inline rename/recolour for categories, place
       editing via the sheet, archived toggles with restore.
7. [x] Admin: wide layout.
8. [x] Shelves wall: hover edit on bays, shelves and box cells; empty slots
       are a "put a box here" target for admins; "Add a place" in the header.
9. [x] `bun run typecheck && lint && test`, browser-verify, commit.

## Findings / gotchas

- `Children.toArray` drops `null`/`false` children (so `{cond && <Card/>}`
  costs nothing), but a child component that RETURNS null still gets a
  wrapper div and its margin — a phantom gap in the masonry. `CardGrid`'s
  wrapper divs are therefore `display: none` when `:empty`. Several admin
  sections (`PushToggle`, `SuggestionQueue`, `PhotoDescriptions`) render
  null routinely, so this is the common case, not an edge one.
- Mantine `Modal` unmounts its children when closed, so a sheet that hides
  itself to show another sheet must keep the STATE in the outer component
  (`BoxQuickEdit` holds the draft; only `ResponsiveSheet`'s `opened` flips).
- `column-span: all` resets the multicol flow around it, which visually
  splits the masonry into bands. That is wanted for the shelf builder and
  would be wrong for anything smaller.
- **An inline style outranks the stylesheet.** The empty-slot "+" shipped
  with `style={{ opacity: 0.6 }}` alongside its hover class, so it was
  visible on every slot of every shelf and the hover rule did nothing. Found
  in a browser, not by types or tests. Any element carrying `HOVER_ACTIONS`
  or `HOVER_ONLY` must leave `opacity` alone.
- `biome format` was reformatting the drizzle-generated migration snapshots
  under `db/migrations/meta/` — 200 lines of churn on files nobody edits.
  `biome.json` now ignores that directory.
- Pre-existing and NOT touched here: `bun run lint` fails with three
  `organizeImports` errors in `api/ai/catalog.db.ts`, `api/ai/ask.ts` and
  `api/runtime-imports.test.ts`. Those files are untouched by this work and
  sit in another session's area.

## Things not to do

- Don't make a hover-only control the only way to do something.
- Don't use `title=` for any of these affordances.
- Don't let the box quick-edit write `locationName` over a structured
  placement — see the decision above; that bug was designed out, not fixed.

## Progress log

- 2026-09-21: all of the above built. `bun run typecheck` clean, 257 tests
  pass, and lint is clean on every file this touched (three pre-existing
  failures elsewhere, see above). Driven in a browser against the dev server
  at 1536px:
  - Settings and Admin lay out in columns; Admin's shelf builder spans the
    full width; the two admin sections that render null leave no gap.
  - Shelf wall: every shelf and the bay carry an edit pencil, each box cell
    carries move + edit, and every empty slot is a target. Filling D3 slot 2
    with the unplaced "Garden hoses" toasted, moved it, bumped D3 to 2/6 and
    emptied the "Not on a shelf" strip.
  - Box quick-edit from the wall showed the structured location
    ("D › D3 · slot 2"), handed off to the location picker without nesting
    modals, and came back with its draft intact.
  - Category rename + recolour round-tripped from Settings.
  - Hover-reveal: all 39 hover-only controls compute to `opacity: 0` at
    rest, and the injected rules are in the document's stylesheet list.
  - NOT verified on a real phone viewport: the preview harness's resize call
    times out in this environment, so the narrow case was checked by
    constraining the grid to 380px (collapses to one column) and reading the
    parsed media query, not by driving a phone-sized window.
