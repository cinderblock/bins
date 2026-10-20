/**
 * Pure black and white, the only thing a 1-bit thermal label can show.
 *
 * The prompt asks for black line art and the model draws in colour anyway:
 * a green terminal block, a red wire. An instruction can be ignored; a
 * threshold can't. Transparent areas are flattened onto white first, then
 * every pixel goes black or white at a cut: luminance 128 by default, the
 * same as the operator's label generator, and adjustable per drawing
 * ("Darkness") because a dark fill that should read as paper only turns
 * white if the cut moves below it. Pale colours and off-white backgrounds
 * land on white, dark ones on black.
 *
 * Two stages, so the cut can be redone without the model:
 *
 * - toSource: flattened, greyscale, white margins trimmed. What a drawing
 *   IS, before any decision about where black starts. Kept as its own blob.
 * - toMonochrome: the cut. Run where drawings are made (so the studio
 *   shows what will print), when the darkness changes, and again where they
 *   are placed on a label, because scaling brings grey edges back and
 *   drawings saved before this existed are still in colour.
 */
import sharp from "sharp";

/** The default cut: mid-grey. */
export const DEFAULT_THRESHOLD = 128;

/** The cuts a person may choose; outside this a drawing is all ink or none. */
export const MIN_THRESHOLD = 16;
export const MAX_THRESHOLD = 240;

/**
 * How different from white a margin pixel may be and still count as paper.
 * JPEG noise and anti-aliasing never land on exact white.
 */
const TRIM_TOLERANCE = 30;

/**
 * The drawing without the empty paper around it.
 *
 * The model is asked for 3:2 and draws whatever it draws in the middle, so
 * a small subject floats in white and prints small. Trimming lets it scale
 * up into the label's art box. Only margins go, never proportions. A
 * blank image has no margin to find; it comes back untrimmed rather than
 * failing.
 */
async function trimMargins(image: Buffer): Promise<Buffer> {
  const flat = await sharp(image)
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  try {
    return await sharp(flat)
      .trim({ background: "#ffffff", threshold: TRIM_TOLERANCE })
      .png()
      .toBuffer();
  } catch {
    return flat;
  }
}

/** A drawing before the cut: greyscale, one channel, margins trimmed. */
export async function toSource(image: Buffer): Promise<Buffer> {
  return sharp(await trimMargins(image))
    .toColourspace("b-w")
    .png()
    .toBuffer();
}

/** Clamp a requested cut into the range a person may choose. */
export function clampThreshold(value: number): number {
  return Math.round(Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value)));
}

/**
 * The cut: every pixel at or above `threshold` goes white, the rest black
 * (sharp's rule, which the studio's live preview copies exactly).
 */
export async function toMonochrome(
  image: Buffer,
  options: {
    resize?: { width: number; height: number };
    threshold?: number;
  } = {},
): Promise<Buffer> {
  let pipeline = sharp(image).flatten({ background: "#ffffff" });
  if (options.resize)
    pipeline = pipeline.resize(options.resize.width, options.resize.height);
  return pipeline
    .threshold(clampThreshold(options.threshold ?? DEFAULT_THRESHOLD))
    .toColourspace("b-w")
    .png()
    .toBuffer();
}

/**
 * Fit a drawing into a box at the size it prints: trimmed, scaled up to
 * at most `maxScale`, then cut. Returns the dimensions with the image, so
 * the caller can lay it out.
 */
export async function fitMonochrome(
  image: Buffer,
  box: { width: number; height: number },
  maxScale: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  const trimmed = await trimMargins(image);
  const meta = await sharp(trimmed).metadata();
  if (!meta.width || !meta.height)
    throw new Error("drawing has no readable dimensions");
  const scale = Math.min(
    box.width / meta.width,
    box.height / meta.height,
    maxScale,
  );
  const width = Math.max(1, Math.floor(meta.width * scale));
  const height = Math.max(1, Math.floor(meta.height * scale));
  const png = await toMonochrome(trimmed, { resize: { width, height } });
  return { png, width, height };
}
