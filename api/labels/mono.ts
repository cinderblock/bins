/**
 * Pure black and white, the only thing a 1-bit thermal label can show.
 *
 * The prompt asks for black line art and the model draws in colour anyway:
 * a green terminal block, a red wire. An instruction can be ignored; a
 * threshold can't. Transparent areas are flattened onto white first, then
 * every pixel goes black or white at mid-grey (luminance 128, the same cut
 * the operator's label generator uses). Pale colours and off-white
 * backgrounds land on white, dark ones on black.
 *
 * Run where drawings are made, so the studio shows what will print, and
 * again where they are placed on a label, because scaling a drawing to fit
 * brings grey edges back and drawings saved before this existed are still
 * in colour.
 */
import sharp from "sharp";

const THRESHOLD = 128;

export async function toMonochrome(
  image: Buffer,
  resize?: { width: number; height: number },
): Promise<Buffer> {
  let pipeline = sharp(image).flatten({ background: "#ffffff" });
  if (resize) pipeline = pipeline.resize(resize.width, resize.height);
  return pipeline.threshold(THRESHOLD).toColourspace("b-w").png().toBuffer();
}
