/**
 * Generated line art for labels.
 *
 * Entirely optional: with no API key configured this module reports itself
 * unavailable and labels render as text + QR. A self-hoster must never be
 * required to hold an account with anyone to print a sticker.
 *
 * Deliberately duplicated rather than shared with the print server. bins knows
 * what is IN the box — name, categories, itemised contents — which is exactly
 * what makes a good prompt; a print service handed a title string does not.
 * Sharing would mean either a worse prompt or a coupling to one service.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "../context";

/** Per-image USD cost, so a budget can be enforced before spending it. */
const MODEL_PRICING: Record<string, number> = {
  "gemini-3.1-flash-lite-image": 0.0336,
  "gemini-3.1-flash-image": 0.067,
  "gemini-3-pro-image": 0.134,
  "gemini-3-pro-image-preview": 0.134,
  "gemini-2.5-flash-image": 0.039,
  "imagen-4.0-generate-001": 0.04,
  "imagen-4.0-ultra-generate-001": 0.06,
};

/**
 * The choices a person is offered, cheapest first. Anything else in the
 * pricing table can still be set as the deployment default by env, but the
 * picker keeps to three tiers so the choice is "how much do I care about this
 * one", not a model catalogue.
 */
export type ArtModelInfo = { id: string; label: string; usd: number };
export const ART_MODELS: ArtModelInfo[] = [
  { id: "gemini-3.1-flash-lite-image", label: "Lite", usd: 0.0336 },
  { id: "gemini-3.1-flash-image", label: "Flash", usd: 0.067 },
  { id: "gemini-3-pro-image", label: "Pro", usd: 0.134 },
];

const DEFAULT_MODEL = "gemini-3.1-flash-lite-image";

/**
 * What the label wants: a clean black-and-white line drawing that survives
 * being dithered to 1-bit and printed at 203dpi. Greys and fine hatching turn
 * to mud on a thermal head, so the prompt is emphatic about it.
 */
const SYSTEM_PROMPT = `Generate a simple black and white line drawing of the subject.

- Pure white background, black line art only — no greys, no gradients, no shading fills
- NO text, letters, numbers, or symbols anywhere in the image
- NO borders or frames
- Clean, bold outlines: thicker lines (5-10px) for key shapes, thinner (2-5px) for fine detail
- Simple and uncluttered — focus on the subject, no background scenery
- Subject fully contained in the image, not cropped by the edges
- For plural subjects (cables, batteries), draw one of each distinct type rather than many copies of the same one
- Make specifically named details clearly recognisable (e.g. "USB-A" means a proper USB-A connector)`;

const REFERENCES_NOTE =
  "- Any additional images provided are style references only — take inspiration, don't copy them";

/** A reference picture, already downscaled by the client to a style hint. */
export type ArtReference = {
  mime: "image/jpeg" | "image/png" | "image/webp";
  /** base64, no data-URL prefix. */
  data: string;
};

export type ArtRequest = {
  /** The box's title — the subject. Required: nothing to draw without it. */
  title: string;
  /** The label's subtext lines, folded into the subject. */
  lines?: string[];
  /** Extra guidance typed by the person ("show a coiled cable"). */
  instructions?: string | null;
  /** Up to five style hints, sent alongside the prompt. */
  references?: ArtReference[];
  /** A model id from MODEL_PRICING; omitted = the deployment default. */
  model?: string;
  /** Different nonce, different picture — see generateArtPng. */
  nonce?: string | null;
};

/**
 * The Google Generative Language API key. Named for what it is: every model
 * this module can call (Gemini image models, Imagen) is Google's, and a
 * variable called something neutral would only hide which account is billed.
 */
export function artApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export function artModel(): string {
  return process.env.LABEL_ART_MODEL?.trim() || DEFAULT_MODEL;
}

export function artAvailable(): boolean {
  return artApiKey() !== null;
}

/** Resolve a requested model: only ones this module knows how to bill. */
function resolveModel(requested: string | undefined): string {
  if (requested && Object.hasOwn(MODEL_PRICING, requested)) return requested;
  return artModel();
}

/** What a picker needs: availability, the choices, the default, the spend. */
export function artStatus(): {
  available: boolean;
  models: ArtModelInfo[];
  defaultModel: string;
  spentUsd: number;
  budgetUsd: number | null;
} {
  const def = artModel();
  const models = ART_MODELS.some((m) => m.id === def)
    ? ART_MODELS
    : [
        { id: def, label: "Default", usd: MODEL_PRICING[def] ?? 0 },
        ...ART_MODELS,
      ];
  return {
    available: artAvailable(),
    models,
    defaultModel: def,
    spentUsd: spentThisMonth(),
    budgetUsd: artBudgetUsd(),
  };
}

/** Monthly ceiling in USD. Unset = no ceiling (deliberate, not a default). */
function artBudgetUsd(): number | null {
  const raw = process.env.LABEL_ART_BUDGET_USD?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function artCacheDir(): string {
  return (
    process.env.LABEL_ART_PATH?.trim() ||
    join(process.env.PHOTOS_PATH?.trim() || "./data/photos", "..", "art")
  );
}

export class ArtInputError extends Error {}

/**
 * The subject line, exactly as the operator's label generator builds it:
 * title, an em-dash, the subtext lines joined by commas, then any typed
 * instructions as a sentence. The model is told ONLY the subject — no
 * "contents", no "label", no layout — because framing it as a container's
 * contents got a drawing of a container, and telling it about the label
 * format gets placeholder text and borders.
 */
export function buildSubject(request: ArtRequest): string {
  const title = request.title.trim();
  if (!title) throw new ArtInputError("give the box a title first");
  const lines = (request.lines ?? []).map((l) => l.trim()).filter(Boolean);
  const instructions = request.instructions?.trim();
  let subject = title;
  if (lines.length > 0) subject += ` — ${lines.join(", ")}`;
  if (instructions) subject += `. ${instructions}`;
  return subject;
}

/** The full prompt: the style rules, then the subject. */
export function buildPrompt(request: ArtRequest): string {
  const style = request.references?.length ? `\n${REFERENCES_NOTE}` : "";
  return `${SYSTEM_PROMPT}${style}\n\nSubject: ${buildSubject(request)}`;
}

/**
 * Spend ledger — a JSON file next to the art cache.
 *
 * A file rather than a table because this needs no migration, no sync, and no
 * history: the only question is "how much has been spent this month". Keyed by
 * month so the window rolls without any cleanup job.
 */
type Ledger = Record<string, number>;

function ledgerPath(): string {
  return join(artCacheDir(), "spend.json");
}

function readLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(ledgerPath(), "utf8")) as Ledger;
  } catch {
    return {};
  }
}

function writeLedger(ledger: Ledger): void {
  mkdirSync(dirname(ledgerPath()), { recursive: true });
  writeFileSync(ledgerPath(), JSON.stringify(ledger));
}

/** `YYYY-MM` for the current month, UTC. */
function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function spentThisMonth(): number {
  return readLedger()[monthKey()] ?? 0;
}

function recordSpend(delta: number): void {
  const ledger = readLedger();
  const key = monthKey();
  ledger[key] = Math.max(0, (ledger[key] ?? 0) + delta);
  writeLedger(ledger);
}

export class ArtBudgetError extends Error {}
export class ArtUnavailableError extends Error {}

/**
 * Generate (or reuse) line art, returned as a PNG data URL. Kept for callers
 * that only want the picture; see generateArtPng for the full result.
 */
export async function generateArt(request: ArtRequest): Promise<string> {
  const { png } = await generateArtPng(request);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Generate (or reuse) line art.
 *
 * Cached on disk keyed by model + prompt + references + nonce, so
 * re-previewing or reprinting the same box costs nothing. Image generation is
 * the only part of this system that spends real money per action, and a
 * preview the user rejects should not bill them twice for the same picture.
 * "Another one" is a different NONCE: it misses the cache on purpose, and the
 * result is cached under its own key so choosing it later is free too.
 */
export async function generateArtPng(request: ArtRequest): Promise<{
  png: Buffer;
  cached: boolean;
  model: string;
  costUsd: number;
}> {
  const key = artApiKey();
  if (!key) throw new ArtUnavailableError("no image provider configured");

  const model = resolveModel(request.model);
  const prompt = buildPrompt(request);
  const refDigest = (request.references ?? [])
    .map((r) => sha256Hex(`${r.mime}:${r.data}`))
    .join(",");
  const cacheKey = sha256Hex(
    `${model}\n${prompt}\n${refDigest}\n${request.nonce ?? ""}`,
  );
  const cachePath = join(artCacheDir(), `${cacheKey}.png`);
  const cost = MODEL_PRICING[model] ?? 0;

  try {
    const cached = readFileSync(cachePath);
    return { png: cached, cached: true, model, costUsd: cost };
  } catch {
    // Not cached yet — fall through and generate.
  }

  const budget = artBudgetUsd();
  if (budget !== null && spentThisMonth() + cost > budget) {
    throw new ArtBudgetError(
      `monthly image budget of $${budget.toFixed(2)} would be exceeded (spent $${spentThisMonth().toFixed(2)})`,
    );
  }

  // Charge BEFORE the call so concurrent requests can't both slip under the
  // ceiling, then refund if it fails. The print server's equivalent never
  // refunds, so a run of safety-blocked generations quietly drains the budget
  // with nothing to show for it.
  recordSpend(cost);
  try {
    const png = await callProvider(model, key, prompt, request.references);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, png);
    return { png, cached: false, model, costUsd: cost };
  } catch (err) {
    recordSpend(-cost);
    throw err;
  }
}

async function callProvider(
  model: string,
  key: string,
  prompt: string,
  references: ArtReference[] | undefined,
): Promise<Buffer> {
  // Reference pictures ride as inline parts after the prompt. Imagen models
  // take no image input, so for those the references are simply not sent
  // rather than failing the whole generation.
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  if (!model.startsWith("imagen")) {
    for (const ref of references ?? [])
      parts.push({ inlineData: { mimeType: ref.mime, data: ref.data } });
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "3:2" },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`image provider returned ${response.status}: ${detail}`);
  }

  const body = (await response.json()) as {
    candidates?: {
      finishReason?: string;
      content?: { parts?: { inlineData?: { data?: string } }[] };
    }[];
  };
  const candidate = body.candidates?.[0];
  const inline = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  if (!inline?.inlineData?.data) {
    // A blocked generation is the common failure and it has a real reason
    // attached — pass it through instead of "generation failed".
    throw new Error(
      `image provider returned no image (${candidate?.finishReason ?? "unknown reason"})`,
    );
  }
  return Buffer.from(inline.inlineData.data, "base64");
}
