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
  "gemini-3-pro-image-preview": 0.134,
  "gemini-2.5-flash-image": 0.039,
  "imagen-4.0-generate-001": 0.04,
  "imagen-4.0-ultra-generate-001": 0.06,
};

const DEFAULT_MODEL = "gemini-2.5-flash-image";

/**
 * What the label wants: a clean black-and-white line drawing that survives
 * being dithered to 1-bit and printed at 203dpi. Greys and fine hatching turn
 * to mud on a thermal head, so the prompt is emphatic about it.
 */
const SYSTEM_PROMPT = `Generate a simple black and white line drawing of the subject.

- Pure white background, black line art only — no greys, no gradients, no shading fills
- NO text, letters, numbers, or symbols anywhere in the image
- NO borders or frames
- Clean, bold outlines: thicker lines for key shapes, thinner for fine detail
- Simple and uncluttered — focus on the subject, no background scenery
- Subject fully contained in the image, not cropped by the edges
- For plural subjects (cables, batteries), draw one of each distinct type rather than many copies of the same one
- Make specifically named details clearly recognisable`;

export type ArtRequest = {
  /** The box's name — the primary subject. */
  title: string;
  /** Category names, as subject hints. */
  labels?: string[];
  /** Itemised contents, the most specific signal available. */
  items?: string[];
};

export function artApiKey(): string | null {
  return process.env.LABEL_ART_API_KEY?.trim() || null;
}

export function artModel(): string {
  return process.env.LABEL_ART_MODEL?.trim() || DEFAULT_MODEL;
}

export function artAvailable(): boolean {
  return artApiKey() !== null;
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

/** Prompt built from what bins knows about the box. */
export function buildPrompt(request: ArtRequest): string {
  const subject = request.title.trim() || "a storage box";
  const detail = [...(request.items ?? []), ...(request.labels ?? [])]
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  const contents =
    detail.length > 0 ? `\n\nContents: ${detail.join(", ")}` : "";
  return `${SYSTEM_PROMPT}\n\nSubject: ${subject}${contents}`;
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
 * Generate (or reuse) line art, returned as a PNG data URL.
 *
 * Cached on disk keyed by model + prompt, so re-previewing or reprinting the
 * same box costs nothing. Image generation is the only part of this system
 * that spends real money per action, and a preview the user rejects should not
 * bill them twice for the same picture.
 */
export async function generateArt(request: ArtRequest): Promise<string> {
  const key = artApiKey();
  if (!key) throw new ArtUnavailableError("no image provider configured");

  const model = artModel();
  const prompt = buildPrompt(request);
  const cacheKey = sha256Hex(`${model}\n${prompt}`);
  const cachePath = join(artCacheDir(), `${cacheKey}.png`);

  try {
    const cached = readFileSync(cachePath);
    return `data:image/png;base64,${cached.toString("base64")}`;
  } catch {
    // Not cached yet — fall through and generate.
  }

  const cost = MODEL_PRICING[model] ?? 0;
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
    const png = await callProvider(model, key, prompt);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, png);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (err) {
    recordSpend(-cost);
    throw err;
  }
}

async function callProvider(
  model: string,
  key: string,
  prompt: string,
): Promise<Buffer> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
