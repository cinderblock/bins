/**
 * Label geometry and the content that goes on one.
 *
 * bins renders a FINISHED image and the printer just prints it. That's what
 * makes this portable: anything that accepts an image works — a thermal
 * printer over HTTP, AirPrint, or a PDF to an office printer — instead of only
 * a service that implements some bespoke label API.
 *
 * The device still owns dithering. Ink density is a property of the print
 * head, media and speed, not of the label, so bins emits greyscale at the
 * right pixel size and lets the printer decide how to make it 1-bit.
 */

export type LabelGeometry = {
  /** Portrait pixel geometry as the printer feeds it. */
  widthPx: number;
  heightPx: number;
  dpi: number;
};

/** Parsed from `LABEL_SIZE`, e.g. `4x6@203` (inches @ dpi). */
export function parseLabelSize(raw: string | undefined): LabelGeometry | null {
  const match = raw
    ?.trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)@(\d+)$/);
  if (!match) return null;
  const [, w, h, d] = match;
  const widthIn = Number(w);
  const heightIn = Number(h);
  const dpi = Number(d);
  if (!(widthIn > 0 && heightIn > 0 && dpi > 0)) return null;
  return {
    widthPx: Math.round(widthIn * dpi),
    heightPx: Math.round(heightIn * dpi),
    dpi,
  };
}

/**
 * Which shape of label to produce. These are different jobs, not one job with
 * a flag:
 *
 * - `qr`   — title + QR (+ optional art). A box that must be IDENTIFIED by
 *            scanning. This is the working label.
 * - `art`  — large artwork + title, no QR. Decorative, for containers that
 *            already carry their own permanent identifier, where a second
 *            scannable code would be redundant.
 */
export type LabelTemplate = "qr" | "art";

export type LabelContent = {
  template: LabelTemplate;
  /** The headline — what gets read from across a room. */
  title: string;
  /** What the QR encodes. Ignored by the `art` template. */
  url?: string;
  /** Smaller supporting lines under the title. */
  lines?: string[];
  /** Generated artwork as a PNG data URL, if this deployment makes any. */
  artDataUrl?: string;
};
