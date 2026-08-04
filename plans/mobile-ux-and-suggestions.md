# Mobile UX round + suggested edits

Field reports from a live deployment (2026-08-04). Companion to
`plans/bins.md` — locked decisions there still hold except where this file
says a user decision superseded one.

## Goal

Fix what real phone users hit, and open up box editing without handing
everyone unreviewed control of a box's identity fields.

Reported, verbatim:

1. "trying to add a new category doesn't work well on mobile. the + looks
   like a tappable button but doesn't work. needs a mobile focused revamp
   (keep desktop layout for desktops)"
2. "editing categories modal was hard to close on mobile too"
3. "we don't see a way to rename boxes... is that admin gated?" / "editing
   box size is also locked down"
4. "why can't i go to `/{id}`? I'm stuck at the home page content"

## Diagnosis

1. `LabelChips` rendered the create field as a `TextInput` with
   `leftSection={<IconPlus/>}`. Mantine input sections are
   `pointer-events: none` by default, so the + is pure decoration — the only
   submit was the Enter key, which on a soft keyboard is a "done"/"go" key
   nobody associates with "add this category". Chips were also sm-sized
   (~28px) against a 44px thumb.
2. `ResponsiveSheet`'s phone Drawer used Mantine's default close button
   (~28px, top-right, i.e. the far corner of a phone held one-handed). The
   Categories sheet applies labels instantly, so it had no bottom button of
   its own either — nothing thumb-reachable dismissed it.
3. Correct: name / size / external label are editable ONLY from `/bins`
   after unlocking with the admin password. The bin page has no edit at all,
   even though `bin.setFields` is a member op and members can already change
   location, categories, weight, photos and notes.
4. Working as designed: a bare `/{id}` carries no sticker secret, so the
   shell gate falls through to `<Landing/>` for a device with no identity.
   The access-code form exists but at the deliberately UNLINKED `/join`
   (typing the URL works; nothing points there). From the user's side that
   is an unexplained dead end.

## Decisions already made (don't re-ask)

- **Edit gating (user decision 2026-08-04, answers report 3)**: regular
  members do NOT get direct edit of a box's identity fields. They **suggest**
  changes; an **admin approves**. Same sheet serves both — an unlocked admin
  applies directly, a member queues a suggestion.
- **A way in from a bare `/{id}` (user decision 2026-08-04, answers report
  4)**: supersedes the earlier "the access-code form is not in the visible
  UI" decision in `plans/bins.md`. The signed-out landing now offers an
  explicit way in, and a bare `/{id}` says which box it is and that scanning
  its sticker (or an access code) opens it. `/join` stays the one
  implementation; the landing links to it and hands back the intended path.
- **Touch treatment is `(max-width: 48em), (pointer: coarse)`**
  (`TOUCH_MEDIA` in `app/lib/ui.ts`), deliberately wider than `PHONE_MEDIA`:
  a tablet in landscape has a desktop-sized viewport but still needs
  finger-sized targets and no hover to discover things with. Desktop layout
  is unchanged wherever this is false — the user asked explicitly to keep it.

## Plan / steps

- [x] **Phase 1 — mobile UX + way in** — DONE 2026-08-04
  - [x] `TOUCH_MEDIA` / `TOUCH_TARGET` in `app/lib/ui.ts`.
  - [x] `LabelChips`: touch layout = 44px chips + a real "+ New" chip that
        opens a composer with an explicit **Add** button; desktop layout kept
        byte-for-byte.
  - [x] `ResponsiveSheet`: phone drawer gets an xl close button and a
        full-width bottom dismiss (`dismissLabel`, default "Close", null to
        omit) — this fixes EVERY sheet, not just categories. `LabelSheet`
        passes "Done" and now flushes the buffered weight on close by any
        route (X, overlay, Escape, Done), so its "Save weight" button is
        gone; nothing on that sheet needs a save step anymore.
  - [x] Landing: "I have an access code" → `/join` with `state.next`, which
        returns you to the page that sent you (same-origin paths only); a
        bare `/{id}` names the box instead of showing generic branding.
  - [x] Verified on localhost dev (fresh join by sticker `/100#GS2S`):
        created a category from the touch composer, chip came back checked,
        weight flushed on Done with a toast, bin header showed both. Desktop
        branch re-checked at 1129px — unchanged "new category…" field.
        `/2` signed out shows the Box #2 card; the access-code link carries
        `{next:"/2"}`.
- [ ] **Phase 2 — suggested edits** (design below, not yet built)

## Design: suggested edits (phase 2)

Shape follows the existing retire/restore precedent: the member-facing op is
pushed like any other, the privileged half is server-authored behind
`requireAdmin` so approval can't be forged by a client.

- `bin.suggest` — member op, `{ binId, fields: { name?, sizeClass?,
  externalLabel?, weightGrams? }, note? }`. Reducer materializes a
  `suggestion` row (id = opId, pending). Works offline like everything else.
- `suggestion.resolve` — SERVER-authored, `{ suggestionId, accepted }`,
  emitted by `POST /api/admin/suggestions/resolve` behind `requireAdmin`. On
  accept the endpoint authors a normal server-side `bin.setFields` in the
  same transaction, so approval competes on the existing LWW clocks and the
  reducer needs no special case.
- New materialized `suggestion` table (both StateStore adapters + Dexie
  mirror) + additive migration. Reducer tests must cover out-of-order
  arrival (resolve before suggest).
- UI: bin page "Suggest an edit" (admins: "Edit box", applies directly);
  pending count on the bin page; a review queue on `/admin` showing
  before → after with Approve / Reject.

Open question to raise with the user before building: members can already
change location, categories, weight, and add/delete photos and notes freely.
Moderating only name/size/external-label is defensible (those are the box's
identity) but worth confirming it's the intent.

## Findings / gotchas

- Mantine input `leftSection`/`rightSection` do not receive pointer events
  unless `leftSectionPointerEvents="all"` — never put an action-looking icon
  in one without it. This is the exact bug in report 1.
- Mantine `Chip` sizes top out at `xl` ≈ 40px; a real 44px target needs
  `styles={{ label: { height: 44 } }}`.
- Nested Mantine overlays (a Modal opened from inside a Drawer) fight over
  focus traps — the composer is INLINE in the sheet for that reason, not a
  second modal.

## Things not to do

- Don't restructure the desktop layouts while fixing mobile — the user asked
  for the mobile-focused revamp to leave desktop alone.
- Don't let a member's edit write through directly; that's what the
  suggestion queue is for.
