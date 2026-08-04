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
- [x] **Phase 2 — suggested edits** — BUILT 2026-08-04, on the branch
      `feat/suggested-edits` (commit `f4f23bf`), NOT yet merged to master.
      See "Merging phase 2" below — it needs a migration renumber and the
      shared tree to be quiet.
  - [x] `bin.suggest` (client op) + `suggestion.resolve` (server op),
        `SuggestionState` + `getSuggestion`/`putSuggestion` on `StateStore`,
        all three adapters (memory / Drizzle / Dexie), `suggestion` table,
        Dexie v4 with a `[binId+status]` index.
  - [x] `POST /api/admin/suggestions` (queue, carries each box's CURRENT
        values for the diff) and `.../resolve` behind `requireAdmin`; accept
        authors verdict + `bin.setFields` in one transaction; second verdict
        is a 409.
  - [x] UI: pencil next to the box name on the bin page → `EditBoxSheet`
        (admin edits directly, member suggests with an optional "why"); a
        "waiting for an admin" alert on the bin page; `SuggestionQueue` at
        the top of `/admin`.
  - [x] Tests: 2 convergence (verdict-before-proposal; two admins racing)
        + 2 API (propose → queue → approve → box renamed → 409 → both ops
        pull; dismiss changes nothing, 404 on unknown). 69 pass, 0 fail,
        typecheck + lint clean.
  - [ ] NOT yet done: drive the two new components in a browser. The server
        round-trip is covered by the API tests, but nothing has rendered
        `EditBoxSheet` / `SuggestionQueue` for real. Do this after the merge,
        in the main tree (see the gotcha about the P: worktree).
- [ ] **Phase 3 — PWA push for admins** (user asked for it alongside the
      in-app badge; not started). Sketch: VAPID keypair in env, a
      `push_subscription` table keyed by device, `POST /api/push/subscribe`,
      a service-worker `push` handler that opens `/admin`, and a send on
      `bin.suggest` ingest to every device in the group whose admin has
      subscribed. Needs a decision on who counts as "an admin to notify" —
      the app has no admin *identity*, only a shared password, so
      subscription has to be opt-in from a device that has unlocked admin.

## Merging phase 2

The branch was cut from `dacaf07`, before the concurrent undo/restore work
landed (`82ec335`, `e31ddfe`). To merge:

1. Wait for the main tree to be CLEAN — a merge touches `shared/ops.ts` and
   `shared/reducer.ts`, where the other session has had uncommitted work all
   afternoon. Git will refuse rather than clobber, but don't force it.
2. `git merge feat/suggested-edits`. Expect small conflicts in the op union
   and the reducer switch (both branches append cases); take both sides.
3. Renumber the migration: the branch generated `0006_strong_glorian.sql`,
   but master now has its own 0006 (and an uncommitted 0007). Delete the
   branch's migration + `meta/0006_snapshot.json`, revert
   `meta/_journal.json` to master's, then `bun run db:generate` to emit the
   next free number against the merged schema. The suggestion table is
   purely additive, so the regenerated SQL is the same CREATE TABLE.
4. `bun run typecheck && bun run lint && bun test`, then drive the flow in a
   browser (bin page → suggest → /admin → approve).
5. `git worktree remove` the P: worktree (see gotcha) and delete the branch.

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

RESOLVED (user decision 2026-08-04): identity fields only — name, size,
external label. Everything else a member changes stays instant. Notification
is an in-app badge PLUS PWA push for admins (push is phase 3).

The scope question that prompted that decision: members can already
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
- **Don't put a worktree on the P: share.** `P:\Projects\WIP\personal` is
  `\\uberfall.tsl\Cameron\...`; git refuses to operate there ("detected
  dubious ownership", different owner SID), `bun run format` rewrote line
  endings across all 105 files, `rm` on the SQLite test dir hit EACCES, and
  Vite never finished starting over UNC. Git commands DO work from the main
  repo with an explicit git-dir:
  `git --git-dir="…/bins/.git/worktrees/bins-suggestions" --work-tree="P:/…" …`
  — that's how `f4f23bf` got committed, staging only the 20 real files and
  leaving the line-ending churn unstaged. Next time use a worktree on C:.
- Two sessions generating drizzle migrations in parallel WILL collide on the
  number. The file is disposable — delete it and re-run `db:generate` after
  merging rather than hand-editing `_journal.json`.

## Things not to do

- Don't restructure the desktop layouts while fixing mobile — the user asked
  for the mobile-focused revamp to leave desktop alone.
- Don't let a member's edit write through directly; that's what the
  suggestion queue is for.
