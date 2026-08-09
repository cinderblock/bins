# Admin-defined box sizes

Opened 2026-08-09 (user: "admins also need to be able to change the sizes of
boxes… S/M/L/XL is not enough… and it can't be just a cosmetic layer on top of
the existing kind"). Companion to `plans/bins.md`, whose invariants all apply.

## Goal

Replace a hardcoded four-item list with real, group-defined box types that an
admin controls — as DATA, driven by ops, not a longer array in the UI.

## Where it stands today

`bin.sizeClass` is already free text (`z.string().max(50)`, an LWW scalar on
the existing field clock, column `bin.size_class`). The only thing making it
S/M/L/XL is `SIZE_CLASSES` hardcoded in `app/components/EditBoxSheet.tsx:32`,
rendered as a SegmentedControl.

So widening that array WOULD "work" and is exactly the cosmetic layer the user
ruled out: it still has no definitions, no ordering, no dimensions, and no way
for an admin to curate the vocabulary.

## Decisions already made (user, 2026-08-09 — don't re-ask)

1. **A size is a name plus OPTIONAL dimensions** (L×W×H). Name-only sizes stay
   legal. Dimensions are real data, not a string in the name, so they can
   later drive volume, sorting and "does it fit on that shelf".
2. **Admin-only.** Sizes are a controlled vocabulary like sticker allocation:
   server-authored behind `requireAdmin`. Members pick from the list and
   cannot invent entries. (Deliberately UNLIKE category labels, which any
   member can create.)
3. **Existing values are migrated, not dropped.** Auto-create a size
   definition for each distinct `sizeClass` already in use and relink those
   boxes, so nothing loses its size.

## Design

Follows the `label` precedent exactly — a definitions table plus ops, with
membership as a field on the bin.

- **Table `box_size`**: `id` (uuid), `group_id`, `name`, `length_mm`,
  `width_mm`, `height_mm` (all nullable ints), `sort_order`, `archived_at`,
  `created_at`. Canonical millimetres, like weight is canonical grams — the
  UI converts for display (in/cm per device, reusing the weight-unit pattern
  in `app/lib/labels.ts`).
- **`bin.sizeId`**: a new LWW scalar in `binFieldsSchema`, on its own clock.
  `sizeClass` STAYS as the legacy free-text field rather than being dropped —
  removing it would rewrite history for every existing op, and it costs one
  nullable column to keep old ops meaningful.
- **Ops** (both SERVER-authored, mirroring `bin.retire`/`bin.restore`):
  `boxSize.upsert { sizeId, name, lengthMm?, widthMm?, heightMm?, sortOrder }`
  and `boxSize.archive { sizeId }`. Authored by
  `POST /api/admin/sizes/{upsert,archive}` behind `requireAdmin`, reaching
  replicas by normal pull.
- **Assigning** a size to a box is `bin.setFields { sizeId }` — an identity
  field, so it follows the SAME path `name`/`sizeClass` already do: admins
  apply directly, members raise a suggestion.

### Migration of existing values (decision 3)

Must be op-driven — writing materialized tables outside the reducer is the
project's load-bearing invariant. A one-shot, idempotent server routine:
collect distinct non-null `sizeClass` values per group, author one
`boxSize.upsert` each (sort order in S/M/L/XL order where recognised), then a
`bin.setFields { sizeId }` per affected bin. Skips entirely if that group
already has any `box_size` row, so a restart can't duplicate.

## Touchpoints (in dependency order)

1. `shared/ops.ts` — op union + payload schemas + `sizeId` in binFields.
2. `shared/reducer.ts` — `SizeState`, `boxSize.upsert`/`archive` cases,
   `sizeId` in the LWW field loop (`reducer.ts:242`).
3. `shared/memory-store.ts`, `db/store.server.ts`, `app/lib/store.client.ts` —
   `getSize`/`putSize`/`listSizes` on all THREE StateStore adapters.
4. `db/schema/box-size.ts` + additive migration (table + `bin.size_id`).
5. **Dexie: THREE edits, not one** — `version().stores()`, AND the table lists
   in BOTH `enqueueOp` and `pullOnce` (`app/lib/sync.ts`). Missing the
   transaction lists makes every op that writes the table throw `DexieError`
   in the browser while the whole test suite stays green. This cost an
   afternoon once already; the lists carry a comment saying so.
6. `api/admin.ts` — upsert/archive endpoints behind `requireAdmin`.
7. UI — size management section in `/admin`; `EditBoxSheet` picks from the
   defined list instead of `SIZE_CLASSES`; size shown on the bin page, /bins
   rows and `BinDetailPane`.
8. Tests — reducer convergence (out-of-order upsert vs. assignment; two admins
   racing on one size) + API round-trip + the migration being idempotent.

## Things not to do

- Don't just widen `SIZE_CLASSES`. That is the thing that was ruled out.
- Don't let members author size definitions (decision 2).
- Don't write `box_size` rows outside the reducer, including in the migration.
- Don't drop `sizeClass`; old ops still carry it.

## Progress log

- [x] Design + decisions locked (above).
- [ ] Steps 1–8.
