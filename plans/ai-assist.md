# AI assist — "where does this go?" and "where is my X?"

Companion to `plans/bins.md` (the living plan). This covers the LLM backend
shared by two independent features, and the catalog/caching design that makes
them affordable.

## Goal

Two questions a person standing in the storage space actually asks:

1. **Placement** — "I have a box of USB cables. Which box does it go in, or
   should we start a new one?"
2. **Retrieval** — "Where would I find the good extension cords?"

Both need the same things: the group's boxes, its category vocabulary, its
location layout, and its sorting conventions. So they share one backend.

A third, separate feature (Phase 5 in `plans/bins.md`) rides the same
backend: **vision captioning** of contents photos, which is what makes a
photo-only box findable at all. It is sequenced after the query side.

## Decisions already made (don't re-ask)

- **Online-only is fine** (user decision 2026-09-20). The primary deployment
  is effectively always on the network, so the query path does NOT need an
  offline fallback beyond the MiniSearch browse that already exists. This
  reverses the earlier assumption that drove everything toward on-device.
- **Gemini first, provider-pluggable** (user decision 2026-09-20). The
  deployment already holds `GEMINI_API_KEY` for label art, so the zero-new-
  accounts path is Gemini. OpenAI and Anthropic ship as real, complete
  implementations behind the same interface — set their key (and
  `AI_PROVIDER`) and they work. No vendor is load-bearing.
- **Single-prompt, whole-catalog** — not embeddings, not RAG. At hundreds of
  bins the entire inventory is ~75K tokens against a 1M-token context. The
  placement question *requires* the global view (which boxes have room, which
  category cluster fits), so retrieval-style search can't answer it at all.
  Revisit only at tens of thousands of items.
- **Snapshot + append-only diffs** (user question 2026-09-20, confirmed
  worthwhile). See "Why the diff layer" below.
- **Geometry is described, never read raw** (user decision 2026-09-20). More
  sorting geometries are coming. Nothing outside `shared/locations.ts` may
  read `cols`/`rows`/`span`; callers ask for a `LocationGeometry` descriptor.
- **Member-facing, budget-capped.** Unlike label art (a provisioning action,
  admin-only), placement is the everyday flow — gating it behind the admin
  password would defeat it. Safety comes from a monthly USD ceiling plus a
  per-device rate limit, and `AI_ASSIST_ADMIN_ONLY=1` flips it if an operator
  disagrees.
- **The model never writes ops.** It proposes; a human acts. No suggestion is
  committed without a tap.

## Environment / context

Env vars, all optional — unset means the feature reports itself unavailable
and the UI hides it, exactly like label art:

| Var | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | auto | `gemini` \| `openai` \| `anthropic`. Auto picks the first provider whose key is set, Gemini first. |
| `GEMINI_API_KEY` | unset | Shared with label art — no new account. |
| `OPENAI_API_KEY` | unset | |
| `ANTHROPIC_API_KEY` | unset | |
| `AI_MODEL` | per provider | Overrides the default model. |
| `AI_BUDGET_USD` | unset | Monthly ceiling across every AI feature. Unset = no ceiling (deliberate, not a default). |
| `AI_INPUT_USD_PER_MTOK` | table | Overrides pricing for an unknown/renamed model. |
| `AI_OUTPUT_USD_PER_MTOK` | table | " |
| `AI_ASSIST_ADMIN_ONLY` | off | Put the query surface behind the admin password. |

## Why the diff layer

Prompt caching is a **prefix match** on every provider that offers it. Build
the prompt from live data and any op changes the catalog, so the prefix
changes, so every query pays full price plus a cache write. That is the
worst case *and* the common one: people snap photos while asking where
things go.

So the prompt is layered, stable-content first:

| Layer | Content | Churn |
|---|---|---|
| 1 | Task framing + output schema | never |
| 2 | Sorting conventions, labels, location tree + geometry | rarely |
| 3 | Catalog snapshot, taken at a known `op.seq` | on refresh |
| 4 | Ops since that seq, oldest first, append-only | per write |
| — | The question | every request — after the last breakpoint |

Layers 1-3 stay byte-identical while boxes change, so they keep hitting cache;
only the small tail at layer 4 is uncached. The snapshot regenerates on a slow
cadence (when the diff tail gets long), not per op.

**Load-bearing detail:** diffs must be appended **oldest-first**. Sort them
newest-first and each new op rewrites the layer, destroying the thing the
design exists to protect.

**This matters more on Gemini than on Claude.** Gemini's implicit caching is
the only caching it offers and it fires purely on prefix reuse — without the
diff layer it would essentially never hit for an active group.

### What the diff layer does NOT buy

- **It does not extend a cache entry's life.** That is TTL-bound (Claude: 5
  min, refreshed free on each read). A snapshot valid for a week still goes
  cold between sessions. The win is *within* a session.
- Cross-session warmth would need scheduled re-warming, which is not worth it
  for a few sessions a week.

### Never use Gemini *explicit* caching here

Explicit caching bills a storage meter hourly (~$1/MTok/hr Flash, ~$4.50 Pro)
whether or not the cache is read. A 75K catalog held explicitly on Pro is
~$0.34/hour ≈ $8/day **sitting idle** — far more than it could ever save for a
few sessions a week. Implicit only.

## Plan / steps

1. [x] `shared/locations.ts` — `LocationGeometry` descriptor + tests.
2. [x] `api/ai/` — provider interface, three providers, budget ledger.
3. [x] `api/ai/catalog.ts` — layered snapshot + diff serialization.
4. [x] `api/ai/ask.ts` — placement + retrieval, structured output.
5. [x] Router + config wiring, tests, `group.sorting_notes` (migration 0018)
       and its admin field.
6. [x] Client UI on `/bins`.
7. [x] Vision captioning, on the same backend (2026-09-20).

## Captioning, as built

**Decision (2026-09-20): its own op type, not the suggestion queue.** A
description is derived from a photo, not proposed by a person; hundreds of
them would have turned an admin review queue into a firehose and destroyed
its usefulness for the thing it exists for. Nothing about a caption needs
approving — it needs to be *visible and correctable*, which the photo viewer
does instead.

- **`entry.setAiItems`** (server-authored, `shared/ops.ts`) carries
  `{entryOpId, photoHash, items, model}`. LWW on its own `aiItemsClock`, so a
  re-run with a better model replaces the words wholesale.
- **It attaches to the ENTRY, not the bin.** A box has many photos; per-photo
  keeps provenance, and deleting a photo takes its description with it for
  free.
- **`photoHash` rides the op** so a description can be checked against the
  picture it describes. `describedItems()` in `shared/reducer.ts` is the one
  place that rule lives, and all three consumers (offline search, assistant
  catalog, photo viewer) go through it.
- **It does NOT call `refreshDerived`.** Every other op folds its time into
  the bin's createdAt/updatedAt; a machine reading an old photo is not the box
  being touched, and a backfill would otherwise float every captioned box to
  the top of "recently changed". Consistently skipping is as order-independent
  as consistently contributing — what breaks convergence is doing it only for
  the ops that win.
- **`ai_caption(hash, model)`** (migration 0020) is a derived cache, not group
  state and not group-scoped: keyed by content hash like the blob store, so
  the same image is never paid for twice. Dropping it costs money, never
  correctness.
- **Automatic captioning is opt-in** (`AI_CAPTION_PHOTOS`, default off). It is
  the only action that spends in proportion to how much stuff a group has,
  with nobody pressing anything. The admin panel shows the backlog and the
  estimate first, and runs in batches of 25 so "how much" stays answerable.
- A run commits each photo as it finishes, so hitting the budget ceiling
  halfway keeps what was already paid for.

## Architecture as built

```
api/ai/
  types.ts     vendor-neutral surface: layers, JSON-schema subset, errors
  gemini.ts    default — implicit prefix caching, OpenAPI-subset schema
  openai.ts    strict json_schema, automatic prefix caching
  anthropic.ts EXPLICIT cache_control on the last stable layer, 5-min TTL
  provider.ts  selection (AI_PROVIDER / key order), pricing, askAi()
  budget.ts    monthly USD ledger, itemised per feature
  catalog.ts   pure renderers + CatalogSource; snapshot/diff-tail layering
  ask.ts       the two framings, answer schema, hallucinated-id filter
  handler.ts   HTTP edge: gate, parse, error->status mapping
```

- Route: `POST /api/ai/ask`, `GET /api/ai/status` (member; `dispatch` in
  `api/router.ts`).
- Client: `app/lib/ai.ts` + `app/components/AskAiSheet.tsx`, reached from the
  search box on `/bins` — the typed query doubles as the question, so there
  is no second field.
- `catalog.ts` reads through a `CatalogSource` interface rather than the db
  directly. That is what lets `catalog.test.ts` assert the byte-stability
  property against plain objects; it is not incidental indirection.

## Findings / gotchas

- Gemini's `responseSchema` is an OpenAPI subset, not full JSON Schema — it
  rejects `additionalProperties` and `$schema`. The shared schema is kept to
  the intersection all three providers accept, and each provider sanitizes.
- `op.seq` (autoincrement, indexed with `group_id`) is exactly the snapshot
  cursor this design needs — no new column.
- Claude cache minimums are model-dependent (512 on Opus 5, 4096 on Haiku
  4.5) and a too-short prefix fails **silently** with
  `cache_creation_input_tokens: 0`. At 75K this is moot, but a small group's
  catalog could fall under 4096 on Haiku.
- Token accounting differs by vendor in a way that silently doubles logged
  cost if missed: Gemini's `promptTokenCount` and OpenAI's `prompt_tokens`
  INCLUDE the cached portion (so the uncached remainder is the difference),
  while Anthropic's `input_tokens` EXCLUDES it. Each adapter normalises.
- `bun test` shares one module registry across test files, so a test that
  sets `DATABASE_PATH` hands its database to every later file. The first
  version of `catalog.test.ts` seeded bins 10-12 and collided with
  `api.test.ts`'s allocation sequence. Fixed properly by making the catalog
  read through an injectable source so the test needs no database at all —
  but the sharp edge is still there for the next db-backed test.
- Structured output constrains the SHAPE of a reply, never its truth. The
  model can return a well-formed box number that is retired or belongs to
  another group, and every id becomes a tappable link — so `resolveBoxes`
  re-reads every id and takes the name and location from the database.

## Things not to do

- Don't add embeddings or a vector store. The corpus fits in one prompt and
  vectors can't answer the placement question.
- Don't let the serializer branch on `cols`/`rows`. See the geometry rule.
- Don't sort the diff layer newest-first.
- Don't use Gemini explicit caching.
- Don't reuse the label-art spend ledger file; the budgets are separate line
  items so a captioning backfill can't drain the query budget.

## Progress log

- [x] Design settled (2026-09-20): providers, layering, geometry descriptor,
      member-facing with a cap.
- [x] Built (2026-09-20): all of steps 1-6. `bun run typecheck`, `bun test`
      (208 pass) and Biome clean on every touched file.
- [ ] **Never exercised against a live provider.** Every test is hermetic —
      no key was used, so the three request shapes are written from each
      vendor's documentation and have not had a real 200 back. First run with
      a real key is the actual acceptance test. Watch for: Gemini's
      `responseSchema` rejecting something in the answer schema, and
      OpenAI/Anthropic model IDs drifting (all three are overridable with
      `AI_MODEL`, which is the escape hatch).
- [x] Captioning built (2026-09-20): op type, reducer case + 7 convergence
      tests, `ai_caption` cache, batch job, push trigger, admin panel with a
      cost estimate, photo-viewer disclosure, and both search surfaces
      (offline MiniSearch and the assistant catalog) reading the results.
      221 tests pass.
- [ ] Captioning has also never run against a live provider, and the vision
      request shapes are the least-exercised code here. Watch the first run.
- [ ] Caption QUALITY is the other unknown: the prompt is tuned for retrieval
      ("USB-C cables", not "3 grey cables in a box") but has never been read
      back against real shelf photos. Expect to iterate on `CAPTION_PROMPT`.
- [ ] Placement quality unmeasured. The failure mode to watch is the
      judgment-heavy half — "should we start a new box" — on a Flash-tier
      model. If it disappoints, that is the moment to try `AI_PROVIDER` with
      a stronger model rather than to rewrite the prompt.
