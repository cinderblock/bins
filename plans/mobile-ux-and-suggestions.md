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
  - [x] MERGED to master (`1238519`) — see "Merging phase 2". The merge
        found a bug no test could: `enqueueOp`/`pullOnce` list the tables the
        reducer may write and Dexie won't widen a transaction mid-flight, so
        `suggestions` missing from both made every `bin.suggest` throw a
        DexieError in the browser while MemoryStore and Drizzle tests passed.
  - [x] Verified against the RUNNING dev server (not just the test harness):
        migration 0008 applied to an existing db; a real member token pushed
        `bin.suggest`; `/api/admin/suggestions` returned the proposal with
        the box's current values as the "before"; approving authored
        `suggestion.resolve` (seq 11) + `bin.setFields` (seq 12) and renamed
        #100 to "Wine glasses"/L; a second verdict got 409; a wrong admin
        password got 403. `EditBoxSheet` was screenshotted open on a
        phone-width viewport with the member wording, prefilled name, size
        control, "why", and a disabled-until-changed submit.
  - [ ] Still unproven by hand: the final submit click and the
        `SuggestionQueue` approve button *in the browser*. Not a known
        defect — the Chrome automation could not reliably deliver clicks or
        see portal content (see gotchas). Worth one manual pass on a phone.
- [x] **Phase 3 — PWA push for admins** — DONE 2026-08-04.
  - Who is "an admin to notify" (the open question): a device that proved it
    knows the admin password AND asked. Subscribing goes through
    `POST /api/admin/push/subscribe` (behind `requireAdmin`); unsubscribing
    is `POST /api/push/unsubscribe` with only the device's own token, scoped
    to its own `deviceId` — you can always silence yourself.
  - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`; all three or
    push is off. `bun scripts/generate-vapid.ts` emits a pair. The public key
    rides `/api/landing` (`pushPublicKey`) and doubles as the feature flag —
    `PushToggle` renders nothing without it.
  - `push_subscription` table (migration 0009), NOT op-driven and deliberately
    so: an endpoint is one browser's secret, and replicating it would hand
    every member's replica the ability to notify that person.
  - Delivery is fire-and-forget from the push-ingest path (`api/sync.ts`),
    outside the transaction, skipping the author's own device. A dead
    endpoint (404/410) deletes the row — the only cleanup these rows get;
    anything else is transient and the row stays.
  - Service worker: `public/push-sw.js` pulled in by `workbox.importScripts`
    rather than converting the build to `injectManifest`. The generated SW is
    load-bearing (precache + navigation fallback) and already caused one
    "permanently blank app after a deploy"; two listeners aren't worth owning
    the whole thing. Verified in `build/client/sw.js`.
  - Only suggestions notify. Everything else a member changes applies itself,
    so there is nothing waiting on a human — a notification for it would be
    noise, and noise is how people turn notifications off.

## Round 2 — field reports 2026-08-23

A second batch from the live deployment. Same rules as round 1: reports go in
verbatim, diagnosis separate from the words the user actually said.

Reported, verbatim:

1. "I would like to be able to you swipe between different images in a box
   rather than having to exit out and I'm I'm going up into another one on
   mobile"

(more expected — this section is being filled in as they arrive)

### 1 — swipe between a box's photos ✅ DONE

**Diagnosis.** `PhotoLightbox` took a SINGLE `entry` and knew nothing about
the strip it came from, so it was a dead end by construction: every other
photo cost a close, a re-aim at a 72–84px thumb, and a re-open. That is the
wrong shape for what a box's photos *are* — a contact sheet of one container,
where comparing two shots is the normal thing to want, not an edge case.

**Built.** The lightbox now takes the whole `photos` array plus which one was
tapped, and pages through it in place:

- **Swipe** on touch — hand-rolled drag on one axis (no carousel dependency),
  with the image tracking the finger, end-resistance at the first/last photo,
  and a direction lock (`DIRECTION_SLOP`) so a mostly-vertical drag still
  belongs to the modal's own scrolling. `touch-action: pan-y` on the track.
- **Arrow keys** and **edge buttons** everywhere else, disabled at the ends.
  Buttons are `TOUCH_TARGET` (44px) on a phone, 36px otherwise.
- **`3/12` counter** in the title, so the strip's size is legible from inside.
- **Neighbour prefetch only** — the slide on screen and the two beside it
  fetch their display renditions; the rest render nothing. A box with 30
  photos must not pull 30 full-size renditions because someone opened one,
  and prefetching exactly the neighbours is what makes the next swipe instant
  instead of a flash of "loading…".
- **Delete advances** instead of closing, so clearing several bad shots is one
  pass rather than a round trip each. Undo still backs every one of them.

Both call sites updated (`routes/bin.tsx`, `components/BinPeek.tsx`) — the
scanner peek gets the same pager for free.

Two ordering traps handled, both worth not reintroducing:

- **Which photo is showing is a FALLBACK, not an assignment.** The open effect
  *clears* the internal `activeId` and rendering falls back to the tapped
  entry's id. Setting it instead would leave the first render after opening
  disagreeing with the effect, and a second effect could then "recover" to
  the wrong photo. It also makes re-tapping the same thumb start there again
  rather than resuming wherever the last visit swiped to.
- **The strip is live and shrinks under the viewer.** If the photo on screen
  disappears — another device deleted it, or our own delete raced the Dexie
  live query — the viewer holds its POSITION in the strip, not the identity of
  a thing that's gone, and only closes when there is genuinely nothing left.

**Verified:** typecheck, lint, and 136 tests green. NOT yet hand-verified on a
phone — the swipe itself is the part automation can't honestly prove (see the
Chrome-automation gotcha below). Worth one pass on-device.

**Shipped** as `c329b6a`, deployed to both instances.

### 2 — pinch to zoom ✅ DONE

Reported second-hand ("someone said they wanted pinch to zoom"), then steered
by the user: *"can we just use the technique shown in PhotoSwipe's sources to
make ours better?"* — after an initial lean toward adopting PhotoSwipe itself.
That call was right and is now a locked decision.

**Decision (user, 2026-08-23): port PhotoSwipe's technique, don't adopt the
library.** Adopting it would have replaced the Mantine modal outright, taking
the title, author line, and delete-with-undo against a live-shrinking strip
with it — more disruption than the feature is worth, plus ~40KB of precache.
PhotoSwipe is MIT and so is this repo, so deriving from it is clean; the
credit lives in the header of `app/lib/photoGestures.ts`.

**A regression report 1 introduced, now fixed.** Item 1 set `touch-action:
pan-y` on the swipe track. Per spec that permits *only* vertical panning, so
it silently killed the browser's own pinch-zoom inside the lightbox — which
had worked, since the viewport meta (`app/root.tsx`) sets no `user-scalable=no`
or `maximum-scale`. The viewport is now `touch-action: none` and every axis is
handled explicitly, which is the right answer anyway: sharing axes with the
browser means the two fight over the same fingers.

**Built** — `app/lib/photoGestures.ts`, a Pointer Events engine (so mouse, pen
and touch are one code path) that writes transforms straight to the DOM. React
owns *which* photo is showing and must never re-render per pointermove.

What was borrowed, and why each one matters:

| Technique | PhotoSwipe's answer |
| --- | --- |
| Axis lock | `AXIS_SWIPE_HYSTERESIS = 10`px |
| Out-of-bounds drag | `PAN_END_FRICTION = 0.35` |
| Does a release page? | project velocity: `v * rate / (1 - rate)`, rate `0.995` |
| Flick floor | `MIN_NEXT_SLIDE_SPEED = 0.5` px/ms |
| Pinch anchor | `pan = zoomPoint - (startZoomPoint - startPan) * zoomFactor` |
| Overzoom | `UPPER_ZOOM_FRICTION = 0.05`, `LOWER_ZOOM_FRICTION = 0.15` |
| Double tap | within `300`ms and `25`px |

The two that a from-scratch attempt gets wrong:

- **Paging is decided by PROJECTED VELOCITY, not distance.** A fast flick over
  20px means "next"; a slow drag over 150px means "let me look". No distance
  threshold can separate those — the 56px threshold shipped in item 1 was
  wrong for one of the two, always. This also makes drag-out-then-flick-back
  cancel correctly, which a threshold cannot express at all.
- **Pan and page are ONE gesture, with a condition.** Dragging a zoomed photo
  pans it and the leftover past its edge feeds the pager — but only if the
  photo was *already* against that edge when the drag began. Without that,
  panning across a zoomed photo flips to the next one the instant it reaches
  the edge.

Deliberate deviations from PhotoSwipe:

- **Centre-origin coordinates.** PhotoSwipe pans from the element's top-left;
  we use CSS `translate(pan) scale(zoom)` about the centre, so bounds are
  symmetric `±(scaled - viewport)/2` and the pinch formula is rewritten
  against that origin. Same technique, less arithmetic.
- **No spring.** PhotoSwipe settles with a velocity-seeded critically-damped
  spring (dampingRatio 1, naturalFrequency 40). We use a fixed 260ms ease-out:
  it differs only on a hard flick and costs no animation loop. Revisit if the
  settle ever feels wrong; don't "fix" it blind.
- **No drag-down-to-close.** PhotoSwipe has it (`MIN_RATIO_TO_CLOSE = 0.4`).
  Ours would fight the modal's own scrolling and the delete button below.

**Verified:** 21 new unit tests (`app/lib/photoGestures.test.ts`) over the
extracted pure math — 157 total pass — plus typecheck, lint and a production
build. The formulas are exported as pure functions specifically so they could
be tested: multi-touch is the one thing the Chrome automation genuinely cannot
drive, so the arithmetic is where the confidence had to come from. The tests
assert the properties, not the outputs — e.g. that the content under the
fingers is *unchanged* across a pinch, including while the fingers move, and
one test pins the naive centre-scaling version as WRONG so nobody
"simplifies" the anchor formula away.

Still unproven by hand: the gestures themselves on a real touchscreen.

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
- **A new materialized table needs THREE client-side edits, not one**: the
  Dexie `version().stores()`, and the table lists in BOTH `enqueueOp` and
  `pullOnce` (app/lib/sync.ts). Miss the transaction lists and every op that
  writes the table throws `DexieError` at runtime while the whole test suite
  stays green — MemoryStore and Drizzle have no transaction scoping. This
  cost an afternoon; the lists now carry a comment.
- The Chrome automation is unreliable against this app: `javascript_tool`
  frequently cannot see Mantine portal content (`document.body.innerText`
  misses the drawer, `documentElement` sometimes catches it), synthetic
  clicks land on the overlay if fired before the drawer's open animation
  finishes (closing it again), and `Page.captureScreenshot` times out every
  few calls. Screenshots are the only trustworthy oracle. For anything
  server-shaped, curl against the dev API beats driving the UI.
- The dev database `data/bins.db` now has admin password `test-admin` (set
  during verification) and bins 101/102/103 are claimed by throwaway
  "Verifier"/"Suggester" devices. Gitignored dev data, but don't be confused
  by it.
- **`web-push` only speaks HTTPS** (`https.request`, hard-coded), so a local
  `Bun.serve` stand-in can never receive a real delivery — it fails
  ECONNREFUSED against port 443. That's why `api/push.ts` exports
  `setPushTransport`: the tests inject a transport and assert OUR logic (who
  gets notified, what the payload says, 410 retires a row, a failure can't
  break the sync) instead of re-testing RFC 8291 encryption. The library's
  crypto path was smoke-tested separately under Bun and works.
- Web push needs a secure context: `https://` or `http://localhost`. A
  deployment reached by LAN IP over plain http can't offer notifications at
  all, regardless of VAPID keys.

## Things not to do

- Don't restructure the desktop layouts while fixing mobile — the user asked
  for the mobile-focused revamp to leave desktop alone.
- Don't let a member's edit write through directly; that's what the
  suggestion queue is for.
