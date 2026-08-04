# bins — running more than one instance

Companion to `plans/bins.md` (the main living plan). This one covers what the
codebase needs so a SECOND (third, …) deployment of the same `master` can run
a different group with a different security posture, without forking and
without putting operator specifics in tracked files.

Operator-specific hosts/domains/printers for *this* operator's deployments
live in the untracked `plans/local.md` and `plans/tsl.local.md`.

## Goal

One repo, one `master`, N deployments. Features and fixes land on every
instance from the same commit. What differs per instance is **configuration
only**: origin, database, and — new here — the *trust model* (does the
deployment sit on the public internet, or behind a network perimeter?) and
whether it can drive a label printer.

## Decisions already made (don't re-ask)

- **Separate deployments, not one multi-group deploy.** `group_id` exists on
  every tenant table and multi-group works, but two things rule it out here:
  `/api/landing` can only serve the FIRST group's branding (one origin can't
  identify a group — documented limitation in `api/landing.ts`), and the whole
  point is that the instances have *different* security postures. Separate
  database, separate socket, separate reverse-proxy block, same commit.
- **The deploy workflow becomes a matrix over instances**, keyed on the
  self-hosted runner label. Each instance's runner lives on its own host in
  its own container with its own volumes, so `APP_ROOT` (`/srv/bins`) and
  `SOCKET` (`/run/bins/bins.sock`) stay IDENTICAL across instances — only the
  runner label differs. `concurrency` must become per-instance
  (`deploy-${{ matrix.instance }}`) or the two instances serialize behind
  each other for no reason.
- **Trust model is a deploy-time env var, never an admin-UI toggle.** An
  admin mis-click must not be able to turn the internet-facing instance into
  an open one. Env only, set in the host's env file.

## Config surface (proposed)

New env vars, all optional, all defaulting to today's behavior:

| Var | Default | Meaning |
| --- | --- | --- |
| `OPEN_ACCESS` | off | Deployment is behind a network perimeter. Bare `/{id}` URLs work; signed-out visitors get a name-only join card instead of the Landing; sticker QRs are allocated without secret codes. |
| `OPEN_ACCESS_REQUIRE_PRIVATE_CLIENT` | on when `OPEN_ACCESS` | Backstop: the open-join endpoint refuses unless the forwarded client IP is in a private range. Defense in depth behind the proxy's own rule. |
| `LABEL_PRINT_URL` | unset | Generic HTTP endpoint that accepts a **label spec** (JSON, below). When set, the sticker page offers "Print" in addition to the existing export. |
| `LABEL_PRINT_TOKEN` | unset | Optional bearer for the above. |
| `TRANSCRIBE_URL` | unset | An **OpenAI-compatible** `/v1/audio/transcriptions` endpoint. When set, voice memos get transcribed; when unset they stay playable-but-untranscribed. |
| `TRANSCRIBE_TOKEN` | unset | Optional bearer for the above. |
| `TRANSCRIBE_MODEL` | `whisper-1` | Model name passed through to that endpoint. |

`/api/landing` (already unauthenticated) is the natural place to advertise
`openAccess` and `labelPrinting` to the client, so the SPA knows which gate
to show before anyone has a token.

## Work item 1 — `OPEN_ACCESS` mode

Today the ONLY way in is a sticker's `#CODE` fragment (or the unlinked
`/join` access-code page). An instance on a trusted LAN wants neither.

Three separable behaviors, all under the one flag:

1. **Join with no proof.** New `POST /api/auth/join-open { displayName,
   deviceId }` → 404 unless `OPEN_ACCESS`, then resolves the single group and
   calls the existing `mintDevice()`. If the deployment somehow has more than
   one group, refuse — ambiguous, and this mode is for single-group installs.
2. **Shell gate.** `app/routes/shell.tsx` currently sends signed-out visitors
   without a sticker fragment to `<Landing />`. Under open access they get a
   name-only join card instead (the existing `FirstRun` component, minus the
   sticker branch), then continue to wherever they were headed.
3. **Codeless stickers.** `api/allocate.ts` keeps emitting `bin.allocate` ops
   but with `code: null`, and the sticker export/QR emits a bare `/{id}`.
   `bin.secretCode` is ALREADY nullable (see the as-built note in
   `plans/bins.md`), so this needs no migration and no reducer change.
   `join-by-bin` already refuses a null-code bin, which stays correct.

**Keep the display-name prompt.** It is one screen, once per device, and it
is the entire basis of op attribution ("who put that there, when"). Dropping
it to save a tap would make every history entry anonymous forever.

**Keep the admin password.** Retire/restore, allocation, and rotation are
still privileged even on a trusted network. Only the *access code* becomes
pointless; `/setup` should auto-generate and hide it under `OPEN_ACCESS`.

**Perimeter is the reverse proxy's job**, not the app's. The app-side private
-IP check exists only so a proxy misconfiguration is not instantly an open
door. Whether the forwarded client IP is trustworthy depends on the proxy
setup — see the operator notes for the concrete rule per instance.

## Work item 2 — label printing

**Revised 2026-08-02** after seeing the target label design. The original
plan had bins render a finished PNG. That is wrong: the desired label
includes *generated line art* indicative of the contents, and the layout
needs the art and the text to negotiate (the art must not swallow the QR).
A print service that already does that pipeline should keep doing it.

So bins sends a **label spec**, not an image. The repo must not know about
any particular printer, media size, raster format, or art generator:

```jsonc
POST <LABEL_PRINT_URL>          // Authorization: Bearer <LABEL_PRINT_TOKEN>
{
  "title": "Test Fixtures",      // the box name — the big text
  "url": "https://host/42",      // exactly what the QR must encode
  "binId": 42,
  "contents": ["…", "…"],        // itemized contents, for the small list
  "labels": ["electronics"],     // category names, as art/style hints
  "copies": 1
}
```

- **bins owns**: what a bin *is* — title, id, the canonical URL, the contents
  list, categories. Plus batching with per-label status, because a jam
  halfway through 50 boxes must not be silent.
- **The print service owns**: media size, orientation and rotation, layout,
  art generation, dithering, and printer command language. All of it lives
  behind that one URL.

Rendering stays entirely optional: `LABEL_PRINT_URL` unset means the existing
TSV/QR export is the only path, which is what pre-printed-sticker operators
use.

**Design reference** (from the operator's sample, and what the spec has to be
sufficient to produce): a landscape canvas rotated 90° for a portrait feed —
box title in very large bold type across the top, contents list smaller down
the left, generated line art filling the middle, QR in the bottom-left
corner. Pure 1-bit black and white; no grays, thick strokes, no border.

## Work item 3 — richer contents (sorting / categories / text search)

Some deployments are "which tote is the shade cloth in" (photo + a couple of
notes is plenty). Others are closer to a warehouse and want to find *items*,
not boxes. What already exists:

- Many-to-many category labels with colors, filter chips on `/bins`.
- Optional per-box weight.
- MiniSearch fuzzy search over names, labels, and notes — offline, merged
  into `/bins` as the single browse surface.

The real gap is **itemized contents**: a structured list of things in a box,
each searchable, rather than prose in a note. Two sources feed one list:

- **Manual** — a new op (`bin.setItems` LWW, or append-only `entry.addItem`
  with tombstones; append-only matches the existing entry machinery and
  avoids a whole-list clobber when two people edit offline).
- **Derived** — the unbuilt Phase 5 vision job in `plans/bins.md` already
  proposes exactly this shape (`bin.aiItems`, server-authored, feeds search
  for free). Worth pulling forward rather than designing a parallel feature.

Both must fold into the MiniSearch index, and the index must stay a pure
function of replica state so it rebuilds offline.

Possible additional gap: **hierarchical** categories (labels are flat today).
Flat + good search covers a surprising amount; only add depth if flat
demonstrably fails.

## Work item 4 — voice memos

Current state: `NoteSheet` is keyboard-dictation-first (iOS's built-in mic is
on-device and works offline) with an optional Android `SpeechRecognition`
stream. There is no audio capture, and `plans/bins.md` deliberately ruled out
a custom iOS mic feature because live recognition is unreliable in installed
PWAs.

A *recorded* memo dodges that entirely and fits the existing architecture:

1. `MediaRecorder` captures audio in the capture overlay, next to the photo
   button. No recognition in the browser, so no online requirement.
2. The audio becomes a **content-addressed blob** in the existing blob
   outbox — the same retry-safe, upload-later path photos use. This is the
   whole reason the design works offline in a storage unit.
3. The op references the blob (an entry kind alongside `contents_photo` /
   note), so it appears in history immediately with a "transcribing…" state.
4. **Server-side transcription** when the blob lands. The transcript becomes
   the entry's text, syncs to every replica, and feeds search for free.

### Speak the OpenAI transcription API, don't invent a shape

`TRANSCRIBE_URL` should point at an **OpenAI-compatible
`POST /v1/audio/transcriptions`** (multipart: `file`, `model`; returns
`{ text }`). That one decision buys a lot:

- It is the de-facto standard. Speaches (née faster-whisper-server),
  whisper.cpp's `whisper-server`, LocalAI, vLLM, and OpenAI itself all
  implement it. A self-hoster points the var at whichever they have.
- It means **there is no service to write** — the "transcription service" is
  someone else's container plus a URL. Nothing to maintain, nothing to
  security-patch, no bespoke protocol to document.
- An operator can start with a hosted API and move to a local GPU (or the
  reverse) by changing one env var.

Note the deliberate contrast with the label endpoint (work item 2), where a
bespoke spec IS right — no standard exists for "print a label with generated
art". Here one exists. Use it.

### Transcription must never be on the critical path

The transcript is an **enrichment that may never arrive**. Deployments
without a `TRANSCRIBE_URL` are a supported configuration, and even where one
is set the service is a separate machine that will be down sometimes.

- Never block the blob upload or the op on it. Queue, retry with backoff,
  give up gracefully.
- The UI must distinguish the states honestly: *waiting to upload* (offline,
  the memo is only on this device) vs *uploaded, transcribing* vs
  *transcribed* vs *no transcription available*. Collapsing these into one
  spinner will produce bug reports that are really just a device in a dead
  zone.
- A memo recorded offline can't be transcribed until the device syncs. That
  is inherent, not a defect — but it means the *audio* has to be the durable
  artifact and the text merely derived from it.

Note the cache-policy consequence: audio blobs are small, but the existing
`prunePhotoCache` policy is photo-shaped. Audio should follow the "thumb"
tier (keep forever) or be dropped locally once transcribed — decide before
shipping, not after replicas fill up.

## Work item 5 — per-deployment URL scheme for boxes

Raised by the user 2026-08-02. Today the sticker URL is hardcoded as
`{origin}/{id}#{CODE}`, with `binIdFromScan` also tolerating `?CODE` and
`code=` for hand-typed input. Under `OPEN_ACCESS` it becomes `{origin}/{id}`.
That is already two schemes, so the concept should be explicit rather than
implied by a flag.

What can legitimately vary per deployment:

- **Secret or not** — `/{id}#{CODE}` vs `/{id}`. Falls out of `OPEN_ACCESS`.
- **Zero-padding** — `/{id}` vs `/0042`. The sticker export already offers a
  selectable pad width; the parser must strip leading zeros either way (it
  should be checked that it does).
- **Path prefix** — `/{id}` vs `/b/{id}`. Only matters if the origin is
  shared with other content. Probably not worth building until it is.

What must NOT vary: the parser has to keep accepting every historical form,
because stickers are physical and outlive config changes. Anything encoded on
a sticker is permanent — a scheme change must be additive to the parser, never
a replacement. This is the single most important constraint in this section.

**The real tension is QR density, and it deserves attention before any
stickers get printed.** The `id` is 2–4 characters; the ORIGIN dominates the
encoded length. A short host keeps the QR coarse-moduled and scannable from a
distance in bad light, which is the entire point of the sticker. Two things
work against making that a per-deployment knob:

- `plans/bins.md` locks **one origin per deployment** — manifest scope,
  service worker registration, and sticker URLs must all agree, or the
  installed PWA breaks. A short alias used *only* for stickers would land
  scanners on an origin whose service worker and stored identity are
  different. Don't.
- So the lever is not a URL-scheme setting at all: it is **choosing a short
  hostname when the deployment is created**. A LAN-only deployment can afford
  a much shorter host than a public one, and that decision is effectively
  permanent once stickers are on boxes.

Also note IDs come from one global sequence *per database*. Separate
deployments have separate databases, so both will hand out a box `#10`. That
is harmless (different origins, and the token authorizes) but it does mean
box numbers are not globally unique across the two instances — don't build
anything that assumes they are.

## Work item 2b — label generation moves INTO bins (supersedes part of 2)

**Reversed 2026-08-03, at the user's direction, and they are right.**

Work item 2 said: bins posts a SPEC, and the print service owns layout, art,
and rasterisation. That optimised for "don't duplicate the print service's
pipeline". The better axis is **printer independence**: if bins produces a
finished image, then any printer that accepts an image works — a Jiose via
LabelPi, a Brother QL, a Zebra, AirPrint, or a PDF to an office printer. A
spec-shaped API only ever works with a service that implements that spec.

It also puts generation where the DATA is. bins knows the box name, contents,
categories and photos; a print service handed a title string knows almost
nothing, which matters most for artwork.

### The new line

- **bins owns**: what goes on the label, layout, QR, artwork, and preview.
  It emits a finished image at the target pixel geometry.
- **The printer owns**: media handling, dithering, and printer command
  language. Dithering stays on the device side deliberately — it depends on
  head density, media and speed, which are properties of the printer, not of
  the label.

So bins sends a **greyscale PNG at the label's pixel size**, and the device
does the final 1-bit conversion. `LABEL_PRINT_URL` stays; only the body
changes from JSON to an image.

### Two capabilities, not one

The user's own observation, and it matters: **printing and AI art are
different categories** and must be independently switchable.

| Capability | Config | Notes |
| --- | --- | --- |
| Printing | printer URL/target | Can this deployment put ink on stock? |
| Artwork | provider + key | Costs real money per image. Always optional. |

Every combination is legitimate: plain title+QR labels with no art; art
generated and viewed in-app without a printer; both; neither (today's
default, and what a fresh self-hoster gets).

### Label templates

Two shapes, because the jobs differ:

- **`qr`** — title + QR (+ optional art). The utility label. A box that needs
  to be *identified* by scanning.
- **`art`** — large artwork + title, **no QR**. Decorative. This is the Math
  Camp case: those boxes already carry a permanent pre-printed serial sticker,
  so a generated sticker there is illustrative, not functional. Forcing a QR
  onto it would be redundant.

### The real implementation fork: where do pixels get made?

bins has NO runtime rendering capability today — `sharp` is a devDependency
used only by `scripts/generate-icons.ts`.

- **(a) satori → SVG → raster.** Pure JS/WASM, and critically **satori
  converts text to vector paths using a font buffer bundled in the repo**. The
  output has no font dependency at raster time, so the label is byte-identical
  on a dev box, in CI, and on either host. This kills an entire class of bug —
  the one that just cost time on the print server, where node-canvas has no
  Windows binding and a missing system font renders tofu.
- **(b) node-canvas.** Familiar API; native module. Already demonstrated not
  to build on the Windows dev box, and depends on host fonts. Same trap.
- **(c) Render in the browser and upload the PNG.** No server rendering deps
  at all, and preview is free because it's the same canvas. But artwork needs
  a server call anyway (the API key must never reach a browser), printing then
  depends on whichever phone rendered it, and two devices with different fonts
  produce different labels.

**DECIDED 2026-08-03: (a) satori.** Deterministic output and no native
dependency are worth more than API familiarity, and this repo is meant to be
self-hostable by strangers on hardware we will never see.

Also decided: **two templates** (`qr` and `art`), and **Math Camp gets neither
capability for now** — build for TSL, flip Math Camp on later once it's proven.

### As built (foundation, 2026-08-03)

`api/labels/spec.ts` + `api/labels/render.ts`, 7 tests in `render.test.ts`.
satori 0.29 + sharp, font from `@fontsource/inter` (`.woff`, since satori
takes ttf/otf/woff but NOT woff2).

Verified by rendering and looking at the output — which is the point of the
approach, and was impossible with the canvas route.

Gotchas hit while building it, all fixed:

- **`sharp` was a devDependency.** The release deploy runs `bun install
  --production`, which would have dropped it and crashed the renderer in
  production while working perfectly in dev. Moved to `dependencies`.
- **`QRCode.toDataURL` is browser-only under Bun** (same trap as the print
  server). `toString({type:'svg'})` is pure JS; it's rasterised with nearest-
  neighbour so module edges stay on pixel boundaries for the printer's dither.
- **A long title was silently clipped.** The first cut used
  `maxHeight` + `overflow: hidden`, and the width estimate was optimistic, so
  the third line was cut in half. Both fixed: the estimate now errs high
  (0.58 em advance, 1.25 line box) and the clip is gone entirely — a box name
  must never be quietly truncated.
- satori will wrap but will not SHRINK, so the size has to be chosen before
  layout; the estimate only needs to be conservative, not exact.

Still to build: the art provider, the print transport (POST the PNG), a
preview endpoint, and wiring the "Label" button to templates.

### Consequence for the print service

It gets **dumber, not smarter** — eventually just "accept an image, print it".
That is close to true already: its IPP path accepts `image/png` today. No
spec-shaped endpoint is needed from it after all; the earlier request in
`LabelPrinter/plans/label-api-for-bins.md` should be narrowed to "an HTTP way
to POST an image", or dropped in favour of driving its existing IPP endpoint.

## Work item 6 — structured locations (shelves with slots)

Raised by the user 2026-08-02: a warehouse has pre-labeled shelves, and a
shelf has *capacity and shape* — "H4 holds 6 banker's boxes, 3 wide by 2
tall". The flat name list can't express that.

### The constraint that shapes this

**Bins reference locations by NAME, not by id.** `bin.setLocation`'s payload
is `{ locationName: string | null }` (`shared/ops.ts`), and `db/schema/
location.ts` says so explicitly: the location table is a *suggestion list*, so
freeform one-off places need no row. Consequences today:

- Renaming a shelf silently orphans every box on it.
- "Is H4 full?" means counting a string match, which a typo defeats.
- Nothing can hang off a location, because nothing points at one.

So structured locations require bins to reference a location **by id**. That
is a change to a load-bearing op, and it's the bulk of the work here.

### Proposed model

Keep one op and one LWW clock, so a box can never hold two conflicting
locations:

```jsonc
// bin.setLocation — payload gains fields; exactly one addressing mode wins
{
  "locationId":   "uuid | null",  // structured: points at a location row
  "locationName": "string | null", // freeform: unchanged, still supported
  "slot":         "string | null"  // position within the location, e.g. "A2"
}
```

Old ops carry only `locationName` and keep parsing unchanged — additive, and
both modes fold into the same `location` field clock, so a structured set and
a freeform set compete like any other LWW pair rather than coexisting.

Locations gain shape:

- `parentId` — hierarchy (`Warehouse → Aisle H → Shelf H4`). Flat installs
  never set it and see no change.
- `cols` / `rows` — the grid. `H4` with `cols: 3, rows: 2` has six addressable
  slots; `slot` on the bin is the coordinate. Capacity is `cols × rows`, so
  "H4 is full" is a count, and the UI can draw the shelf as a 3×2 grid showing
  which box is where — which is the actually-useful view when hunting for a
  box, and exactly what a scanning system would populate later.

**Slots are coordinates, not rows.** The alternative — generating six child
location rows per shelf — is uniform but multiplies the location list by the
capacity of the building, and every one of those rows is a thing to rename,
archive, and sync. A coordinate on the bin costs nothing when unused.

### Gotchas to design against

- **Cycles.** Two devices can reparent offline such that A→B and B→A. Any
  parent walk (breadcrumbs, capacity roll-up) must be depth-capped and
  cycle-safe, and the reducer must stay order-independent through it. This is
  the one genuinely dangerous part of adding hierarchy to an LWW op log.
- **Renames stop being destructive** once bins point at ids — that's the
  upgrade — but the migration has to map existing `locationName` strings onto
  rows without inventing locations for typos.
- Freeform must survive. "Sam's truck", typed once offline, is a legitimate
  location and must not require a row.

### This does NOT block getting started

The existing flat list already accepts `H4` as a plain name. A warehouse can
be fully usable — boxes labeled, shelved, and findable — with shelf names as
locations, and the grid/slot model is an upgrade applied later without
re-labeling anything. Locations are recorded in the app and changeable at any
time; only the sticker is permanent.

### Forward compatibility: continuous scanning

The user's eventual goal is a device that continuously recognizes boxes and
records where they are, shared live with everyone. Two notes so today's model
doesn't foreclose it:

- **It cannot be the PWA.** iOS Safari has no WebXR AR support, so continuous
  AR scanning means a native app. That is fine and needs no architectural
  change: bins already has write-scoped **integration tokens** and a sync
  push/pull protocol, so a native app is just another op author. This is
  precisely the case the integration API was built for.
- **Model it as observations, not edits.** A scanner produces *sightings*
  ("bin 42 seen at H4 slot A2 at time T"), which are append-only and
  conflict-free — the same shape as photos and notes — with the current
  location derived from the latest sighting. Retrofitting that onto an op type
  that only supports authoritative sets is much harder than leaving room for
  it now.

## Work item 7 — box lifecycle: permanent vs reusable containers

Raised by the user 2026-08-02, and it invalidates an assumption baked into
the current model.

### Two different things are being tracked

- **Permanent** (the original assumption): the container is the tracked
  object. A pre-made sticker carries a serial that never changes, so the bin
  id IS the physical tote's identity. Stickers are batch-allocated ahead of
  time and adopted by claim-on-first-scan. Retirement is rare and privileged.
- **Reusable**: the container is a commodity drawn from a pile of empties.
  What is actually tracked is *a batch of stuff currently living in some box*.
  You fill a box, THEN create the record, THEN print one sticker. When it is
  emptied the box rejoins the pile and its record is done.

The second inverts the order of operations, which is why three current
behaviors are wrong for it:

1. **Batch allocation is the wrong primitive.** `/print` hands out a sheet of
   ids up front. Reusable-container sites want "create this box now, print its
   one label now".
2. **Allocation is admin-gated**, correctly, because handing out the global id
   sequence is a provisioning action. Where boxes are created constantly by
   everyone, that gate is in the way.
3. **Claim-on-first-scan has nothing to adopt** — no unclaimed sticker exists
   before the box does.

### What must NOT change: ids are never reused

The global monotonic sequence already guarantees this and it has to stay.
If box 52 is emptied and that physical box later carries sticker 193, a
leftover 52 sticker must resolve to "emptied on «date»", never to someone
else's contents. Reuse would silently mis-attribute real inventory.

This is also why **"delete" should mean archive**: the op log is append-only,
the history is worth keeping ("what was in that box last year?"), and the id
stays burned. `bin.retire` is already exactly this primitive — it needs
different *permissions* and *wording*, not a different mechanism.

### Stale stickers are a real hazard here

A physical box can end up wearing two stickers if the old one isn't peeled.
Scanning the dead one must say so plainly — "This box was emptied on «date».
Remove this sticker." — rather than showing an empty box page that looks like
a data-loss bug. Cheap to build, and it is the failure mode this workflow
generates most.

### Decided 2026-08-02 — and the proposed config flag was DROPPED

A `BOX_LIFECYCLE = permanent | reusable` flag was proposed here. The user's
answers dissolved the need for it, which is worth recording so nobody
reintroduces it:

- **Emptying = archive, hidden by default.** Already exactly what
  `bin.retire` does: retired boxes drop out of `/bins` and out of the search
  index unless an admin unlocks. No change needed.
- **Creating and emptying stay ADMIN-GATED** (user decision, against the
  recommendation to open them up — an admin device stays unlocked in practice,
  so the gate is not friction). No permission change needed.
- **No id on the printed label at all** — title, art, QR only. That is a label
  *template* decision living on the printer side, not a deployment mode.

What is left is three changes, none of which need a flag because none of them
are wrong anywhere:

1. **"New box"** — mint ONE id and go straight to it, instead of only being
   able to batch-allocate a sticker sheet. Useful everywhere;
   `plans/bins.md` Phase 4 already wanted an offline new-box path. Admin-gated,
   matching allocate.
2. **Stale-sticker handling** — scanning a retired box currently shows a small
   grey "retired" badge, which reads like a data bug. It must say plainly that
   the box was emptied, when, and that the sticker should come off. This is the
   failure mode a reusable-container workflow generates most.
3. **Label template omits the id** (work item 2's spec already carries `title`
   and `url`; the renderer simply doesn't draw a number).

The app UI still leads with `#id`, deliberately: in-app the id is a useful
handle that disambiguates two boxes with the same title. It is only redundant
on the label, where the QR already carries it.

## Things not to do

- Don't add a UI toggle for `OPEN_ACCESS`. The perimeter and the trust model
  must be configured together, by whoever configures the proxy.
- Don't let `LABEL_PRINT_URL` be reachable from client code with the token —
  the POST happens server-side.
- Don't fork the repo per instance, and don't add instance names to tracked
  files. If something can't be expressed as config, it's a design bug.
- Don't drop the display-name prompt in open-access mode (kills attribution).
- Don't build browser-side speech recognition for offline memos — record the
  audio and transcribe it server-side.

## Decisions from the user (2026-08-02)

- **Itemized contents**: build the **manual op first** — it's the durable
  data model — then let the vision job author into the same list later.
- **Transcription**: a **local model on the host**, reached through the
  generic `TRANSCRIBE_URL`. Instances without one leave memos playable but
  untranscribed; the transcript is an enrichment, never a requirement.
- **Label**: **one label per media sheet**, spec-based (work item 2).
- **Runner labels**: leave the existing instance's label alone; the new
  instance gets its own. Renaming a working runner to gain symmetry is a bad
  trade.

## Open questions for the user

1. **Sticker scheme is permanent.** Confirm the QR encodes a bare `/{id}` on
   open-access instances before any stickers are printed — a change after the
   fact means re-stickering every box (see work item 5).
2. **Contents list on the label** — printed labels are a *snapshot*, but box
   contents change constantly. Print the contents list at all, or leave the
   label to title + art + QR and let the QR be the source of truth?
