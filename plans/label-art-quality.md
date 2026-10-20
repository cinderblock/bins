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
7. [ ] **Current:** deploy. The pin is staged (operator specifics in
       `plans/*.local.md`) and needs the operator's yes. Then one real
       generation to see the pipeline live: check `textRemoved`, the
       monochrome result, and the latency the text check adds.
8. [ ] Optional follow-ups for the operator to choose: aspect ratio fitted
       to the art box (LabelPi does this; we always ask 3:2); a persisted
       history of recent candidates per box (LabelPi keeps 20 in
       IndexedDB); a gentler colour treatment than a hard threshold for dark
       fills.

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
