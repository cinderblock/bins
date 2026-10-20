/**
 * Find the words a drawing should not have, so they can be painted out.
 *
 * The prompt says "NO text" and the image models write it anyway, most of
 * all when the subtext lists kinds of a thing ("Official, Knockoff, ODESC"):
 * they caption each one. Rewording the prompt, a wordless-manual framing,
 * dropping the subtext, a costlier model, and asking the model to edit its
 * own words out all failed in testing (plans/label-art-quality.md). What
 * works is asking a vision model where the text is and painting those boxes
 * white. Captions sit beside the thing they name, so erasing them leaves
 * the drawing whole.
 *
 * This only ever subtracts. A wrong box costs a patch of white in a line
 * drawing; a missed one is the text we already had. So a failed check never
 * fails the drawing. The caller keeps it and says the check didn't run.
 */
import sharp from "sharp";
import { geminiProvider } from "../ai/gemini";

/** A text model, not an image one: it reads the drawing and draws nothing. */
const TEXT_MODEL = "gemini-3.6-flash";

/** Margin around each box, in pixels of the drawing as generated. */
const PAD = 6;

const PROMPT =
  "Find every piece of written text in this line drawing: words, letters, numbers, captions, labels, logos made of letters, and tiny markings. Return one bounding box per piece of text, as box_2d [ymin, xmin, ymax, xmax] normalised to 0-1000, with the text you read. If there is no text at all, return an empty list. Do not box drawn shapes that merely resemble letters.";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    texts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
        },
        required: ["text", "box_2d"],
      },
    },
  },
  required: ["texts"],
};

/** A piece of text, in pixels of the image it was found in. */
export type TextBox = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Where the text is. Throws on any failure (network, refusal, a reply that
 * isn't the shape asked for); the caller decides what that means.
 */
export async function findText(
  image: Buffer,
  key: string,
): Promise<{ boxes: TextBox[]; costUsd: number }> {
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height || !meta.format)
    throw new Error("drawing has no readable dimensions");
  const { width, height } = meta;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: `image/${meta.format}`,
                  data: image.toString("base64"),
                },
              },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          // Same boxes as the default level in testing, at a third of the
          // time and cost: finding words doesn't need deliberation.
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`text check returned ${response.status}: ${detail}`);
  }
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };

  const reply = (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  const parsed = JSON.parse(reply) as {
    texts?: { text?: unknown; box_2d?: unknown }[];
  };
  if (!Array.isArray(parsed.texts)) throw new Error("text check: no list");

  const boxes: TextBox[] = [];
  for (const item of parsed.texts) {
    const box = item.box_2d;
    if (
      !Array.isArray(box) ||
      box.length !== 4 ||
      !box.every((n) => typeof n === "number" && Number.isFinite(n))
    )
      continue;
    const [y0, x0, y1, x1] = box as [number, number, number, number];
    const left = Math.max(
      0,
      Math.floor((Math.min(x0, x1) / 1000) * width) - PAD,
    );
    const top = Math.max(
      0,
      Math.floor((Math.min(y0, y1) / 1000) * height) - PAD,
    );
    const right = Math.min(
      width,
      Math.ceil((Math.max(x0, x1) / 1000) * width) + PAD,
    );
    const bottom = Math.min(
      height,
      Math.ceil((Math.max(y0, y1) / 1000) * height) + PAD,
    );
    if (right <= left || bottom <= top) continue;
    boxes.push({
      text: typeof item.text === "string" ? item.text : "",
      left,
      top,
      width: right - left,
      height: bottom - top,
    });
  }

  // Billed at the assistant's own rate for this model. Thinking tokens are
  // output tokens as far as the invoice is concerned.
  const pricing = geminiProvider.models.find((m) => m.id === TEXT_MODEL);
  const usage = body.usageMetadata ?? {};
  const costUsd = pricing
    ? ((usage.promptTokenCount ?? 0) * pricing.inputUsd +
        ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) *
          pricing.outputUsd) /
      1_000_000
    : 0;

  return { boxes, costUsd };
}

/** Paint each box white. The image keeps its size and everything else. */
export async function eraseText(
  image: Buffer,
  boxes: TextBox[],
): Promise<Buffer> {
  if (boxes.length === 0) return image;
  const meta = await sharp(image).metadata();
  const rects = boxes
    .map(
      (b) =>
        `<rect x="${b.left}" y="${b.top}" width="${b.width}" height="${b.height}" fill="#ffffff"/>`,
    )
    .join("");
  return sharp(image)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${meta.width}" height="${meta.height}">${rects}</svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}
