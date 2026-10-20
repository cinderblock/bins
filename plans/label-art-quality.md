# Label art: monochrome, no text, paste references, remove drawings

Companion to `plans/warehouse-features.md` (label studio, §6) and
`plans/bins.md`. Operator specifics stay in the untracked `plans/*.local.md`.

## Goal

Operator feedback after the first real use of the label studio (2026-10-19):

1. **Drawings come out in colour.** The printer is a 1-bit thermal head; a
   green terminal block is halftone mush on paper, and the studio shows a
   picture that isn't what prints.
2. **Drawings contain text.** Each variant got a caption ("ODrive Official",
   "Knockoff ODrive", "ODESC"), despite "NO text" in the prompt.
3. **Reference pictures can't be pasted**, only uploaded as files.
4. **Generated pictures can't be removed**, neither from the candidate strip
   nor as the box's chosen drawing.

"Take inspiration from LabelPi" (the operator's label generator, the
LabelPrinter repo), which does not have these problems in day-to-day use.

## Environment / context

- Prompt and provider call: `api/labels/art.ts` (`SYSTEM_PROMPT`,
  `buildSubject`, `callProvider`, `generateArtPng`, `asPng`).
- HTTP edge: `api/art.ts` (`handleArt`, stores the blob, returns a data URL).
- Studio UI: `app/components/LabelStudio.tsx` (candidates are session-only
  React state). Client helper: `app/lib/labelArt.ts` (`makeReference`
  downscales to a 512px JPEG).
- LabelPrinter for comparison: `src/models.ts` (`SystemPrompt`, per-model
  config with `imageSize: '1K'`), `src/backend/services/image-gen.ts`
  (system prompt and `Subject:` sent as SEPARATE text parts, then the
  references).
- Real failing input: title "ODrive", subtext "Official / Knockoff / ODESC",
  so the subject is "ODrive — Official, Knockoff, ODESC". The model drew
  three boards and captioned each.

## Decisions already made (don't re-ask)

- Colour is fixed by **post-processing**, not by prompting harder. A model
  can always ignore an instruction; a threshold can't be ignored, and the
  printer is 1-bit anyway, so the studio should show what will print.
  Luminance 128, the same cut LabelPi uses (`layoutRenderer.ts`
  `compositeLabel`).
- Text is fixed by **detect and erase**, not by prompting: a vision call
  (`gemini-3.6-flash`, thinking `minimal`, structured output) returns a box
  around every piece of text, and those boxes are painted white before the
  threshold. That's the only approach that worked (see findings), at ~0.17¢
  and ~2-4 s per drawing. Charged to the label-art ledger. If the check
  fails, the drawing is still kept, and the studio says it couldn't check.

### Round 2 (operator answers, 2026-10-20)

- **Don't change the aspect ratio** we request (stays 3:2), "but yes" to
  fitting the label better. Read as: trim the drawing's white margins so
  it scales up into the art box, never distorted. (If that reading is
  wrong, the trim is one function in `mono.ts` to drop.)
- **Per-box history: yes.** A server-side `label_art` table (admin-only,
  like generation), not the op log. Reasons: art is online-only by nature
  (generation needs the server), so offline sync buys nothing. Entries
  were the alternative, and they're consumed in ~30 places that assume
  "contents of the box" (gallery, search, captions, catalog, v1 API), so a
  new kind would leak drawings into all of them. `labelArtHash` on the bin
  stays the one synced, printed choice.
- **Dark fills: a slider** ("or a slider?"). It's a threshold control
  ("Darkness"), because a 1-bit label has no grey; it can only move the
  cut. Each drawing keeps its pre-threshold greyscale source blob. The
  studio previews the cut client-side (exactly: a single-channel image,
  `v >= T`, the same rule sharp's `threshold` uses), and on release the
  server re-cuts the source and stores a new mono blob, so `labelArtHash`
  stays exactly what prints.
- **Prompt prefers isometric views** ("we like isometric views a lot").
- **"2-3 different pictures with distinct options":** a "3 variations"
  button: three generations at once, each with a different direction
  (side by side / close-up / flat icon), labelled on their tiles.
- Reprinting Environment Sensors: the operator handles reprints; drop it.
- ISSUES.md entries: leave for other threads.

## Plan / steps

1. [x] Read the LabelPi survey (background agent) and note real differences.
2. [x] Experiment against the live model with the failing subject.
3. [x] Monochrome post-processing (`api/labels/mono.ts`) at generation and
       at the render boundary, with tests.
4. [x] Text detect-and-erase (`api/labels/detext.ts`), wired into
       `generateArtPng`. The cache keeps the raw provider output, and the
       boxes go in a `<key>.text.json` sidecar so a cached read never
       re-bills. The result carries `textRemoved` (null = not checked). The
       stronger "never label" rule wording is adopted too (weak evidence,
       no harm).
       The text model's URL is distinct (`/gemini-3.6-flash:`), so test
       stubs route on it (`art.test.ts`, `api.test.ts`).
5. [x] Paste references: a document `paste` listener (image items only, so
       text pastes into fields pass through) plus a Paste button using
       `navigator.clipboard.read()` for phones. Downscaling unchanged.
6. [x] A ✕ on every finished or failed candidate tile (removing the chosen
       one clears the label's drawing), plus "Remove the drawing from this
       label" under the preview for the box's saved drawing. Each tile
       notes "Text removed in N places" or "Not checked for text".
       Browser-verified on a throwaway db (`bun run dev`, fake key, stubbed
       art response): image paste adds a reference, text paste is untouched,
       tiles remove, and the saved drawing clears to `labelArtHash: null`.
7. [x] Deployed 2026-10-19 at the operator's yes (operator specifics in
       `plans/*.local.md`). Live check via production `generateArtPng`,
       subject "ODrive — Official, Knockoff, ODESC": `textRemoved: 11`, no
       captions left, 1-channel PNG, 7.4 s for generation and check
       together. The third board's dark fill thresholded to solid black,
       the case behind follow-up 8's third item.
8. [x] Follow-ups put to the operator. Answers are in "Round 2" above.

Round 2:

9. [x] Isometric in the rules; `ART_VARIANTS` (group / closeup / icon)
       placed last among the rules so "icon" can overrule isometric; a
       "3 variations" button (`953510e`). Also fixed: overlapping
       generations on a NEW box each allocated a box, and overlapping
       saves each claimed it. Allocation is now shared, and flushes are
       serialized.
10. [x] Margin trim (`6829cb6`): `toSource` (flatten, greyscale, trim
        tolerance 30) at generation, and `fitMonochrome` at the render
        boundary. On Environment Sensors the drawing renders visibly
        larger in the same box.
11. [x] `label_art` table (migration 0021, additive), plus history, cut and
        remove endpoints (`d0c38c1`). The list is newest first, with
        `rowid` breaking same-millisecond ties.
12. [x] Studio (`9657a21`): history tiles, persistent ✕, and a Darkness
        slider (16-240, step 4) with an on-device preview and a queued
        server re-cut. Browser-tested on a throwaway db seeded through the
        real pipeline (`%TEMP%/bins-scripts/seed-history.ts`). The first
        try disabled the slider during a cut, and only 5 of 12 keyboard
        presses landed; with commits queued instead, all 12 did.
13. [x] Deployed 2026-10-20 at the operator's yes. Another thread had
        just pushed an unrelated ops change. The per-server deploy jobs
        have `cancel-in-progress: true`, so I waited for their run to
        finish before pushing, rather than cancel it mid-deploy. Live
        "3 variations" on the ODrive box: all 200, 5.7 s in parallel, pure
        B/W, trimmed, text removed (0/3/3). Side by side and Flat icon did
        as asked. **Close-up drew three boards**: the subtext's three kinds
        beat "one representative item".
14. [x] Close-up direction firmed to "exactly ONE item, even if the
        subject lists several kinds" (`af8674c`). 3 of 3 live tries drew
        one board.
15. [ ] **Current:** deploy `af8674c` (needs the operator's yes).

## Findings / gotchas

- Today's two drawings were stored as real PNGs (the `asPng` fix works) and
  printed with the drawing on the label (LabelPi job 3, 17:03, completed).
- The prompt text is already nearly word-for-word LabelPi's, so the
  difference is not the rules themselves.
- **What LabelPi actually does** (survey 2026-10-19): nothing extra at
  generation time. It thresholds every result to pure B/W at luminance 128
  before showing or saving it, so colour never reaches the screen. It has
  no text guard beyond the prompt and never tells the model about the label
  layout. Paste is `onPaste` on the page wrapper (`LabelGen.tsx`). History
  is 20 recent images in IndexedDB, with a trash button and a confirm. It
  picks the aspect ratio nearest the free art box, where we always ask 3:2.
- **Prompting can't stop the captions** (experiment, subject "ODrive —
  Official, Knockoff, ODESC", 3 runs each unless noted):
  - Lite, current single-part prompt: 3/3 had text.
  - Lite, LabelPi-style separate parts: 3/3.
  - Lite, "never label, caption or name anything; tell kinds apart by shape"
    plus a closing no-words line: 1/3 on the first round, 3/3 on the
    second. The first round was luck.
  - Lite, "wordless assembly-manual" framing: 3/3.
  - Lite, title only (no subtext): 1/2, and that one had silkscreen
    ("GPIO", "JST", "CAN-GH"). Dropping the subtext also loses what to draw.
  - Lite **edit pass** ("remove every word, change nothing else") on 4
    captioned drawings: 0/4. It returned the image unchanged.
  - Flash (6.7¢), stronger prompt: 3/3. Pro (13.4¢): 1/2 had tiny
    silkscreen; the other had none, but a green block.
  - Listing variants is what invites captions: the model labels each kind.
- **Detection works**: `gemini-3.6-flash` boxed the text in 10/10 test
  images, from full captions down to "+ -" pin markings, and returned an
  empty list for the clean one. Erasing the boxes (6px pad) left clean
  boards; only fragments of a letter-shaped logo remained on one.
  Thinking at default: 4-10 s, ~0.4¢. At `minimal`: 1.6-4 s, ~0.17¢,
  same accuracy. `gemini-3-flash-preview` was similar but timed out once.
- Thresholding at 128: a light-green terminal block goes white (good). A
  dark-green PCB goes solid black with white details, heavy but readable,
  and identical to what LabelPi prints. A smarter colour→white pass is a
  possible follow-up, not built.
- Experiment spend: ~$1.15 total, image generations plus detection, outside
  the app's ledger (direct API calls from inside the container). Above
  the "under $1" first estimated, because the model-tier test was added.
- Ops: Windows `scp` with several files hung indefinitely. Pipe tar over
  one ssh instead.

## Progress log

- [x] Collected the failing examples from the store and the exact subject.

## Open questions for the user

(none yet)

## Things not to do

- Don't try to fix colour with prompt wording alone (see decisions).
