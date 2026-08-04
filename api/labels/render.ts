/**
 * Label rendering: content -> PNG, entirely inside bins.
 *
 * satori + sharp rather than a canvas, deliberately. satori converts text to
 * vector PATHS using a font buffer bundled with the app, so the rasteriser
 * never resolves a font by name. That means a label looks identical on a dev
 * box, in CI, and on any host — no native module to build, and none of the
 * "missing system font renders tofu" failures that plague server-side canvas.
 *
 * Everything is laid out LANDSCAPE (long axis horizontal, which is how the
 * design reads) and rotated 90° at the end for the printer's portrait feed.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import QRCode from "qrcode";
import satori, { type SatoriOptions } from "satori";
import sharp from "sharp";
import type { LabelContent, LabelGeometry } from "./spec";

const require = createRequire(import.meta.url);

/** Resolved once — reading two font files per label would be silly. */
let fontCache: { regular: Buffer; bold: Buffer } | null = null;

function fonts(): { regular: Buffer; bold: Buffer } {
  if (fontCache) return fontCache;
  // Resolved through node resolution so it works from a release tree too,
  // where cwd isn't the repo root.
  const dir = require
    .resolve("@fontsource/inter/package.json")
    .replace(/package\.json$/, "files");
  fontCache = {
    regular: readFileSync(`${dir}/inter-latin-400-normal.woff`),
    bold: readFileSync(`${dir}/inter-latin-700-normal.woff`),
  };
  return fontCache;
}

/**
 * QR as a PNG data URL.
 *
 * NOT `QRCode.toDataURL`: under Bun this package resolves to its BROWSER
 * build, whose toDataURL/toCanvas call document.createElement. `toString` with
 * type 'svg' is pure JS and works server-side. Rasterising it at an exact
 * multiple of the module size keeps module edges on pixel boundaries, which
 * matters because the printer's 1-bit conversion turns soft edges into speckle
 * exactly where a scanner needs crispness.
 */
async function qrPngDataUrl(text: string, sizePx: number): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
  });
  const png = await sharp(Buffer.from(svg))
    .resize(sizePx, sizePx, { kernel: "nearest" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Fit the headline to the width available.
 *
 * satori wraps text on its own, but it will not SHRINK to fit, so a long box
 * name would either overflow or wrap to more lines than there is room for.
 * This estimates from Inter's average advance width; being approximate is
 * fine because satori still does the real wrapping — this only picks a size
 * that leaves it enough room.
 */
function titleSize(
  title: string,
  widthPx: number,
  maxHeightPx: number,
): number {
  // Inter Bold mixed-case mean advance / em. Erring HIGH is the safe
  // direction: it predicts more lines than reality, so the chosen size is
  // conservative and the block fits.
  const AVG_ADVANCE = 0.58;
  // A line occupies more than its font-size — ascender plus descender plus
  // the font's own line gap. Sizing against fontSize alone is what clipped
  // the last line of a long title.
  const LINE_BOX = 1.25;
  const start = Math.round(maxHeightPx * 0.42);
  const min = Math.round(maxHeightPx * 0.14);
  for (let size = start; size > min; size -= 4) {
    const perLine = Math.max(1, Math.floor(widthPx / (size * AVG_ADVANCE)));
    const lines = Math.ceil(title.length / perLine);
    if (lines * size * LINE_BOX <= maxHeightPx) return size;
  }
  return min;
}

/** Render to a PNG in the printer's portrait geometry. */
export async function renderLabel(
  content: LabelContent,
  geometry: LabelGeometry,
): Promise<Buffer> {
  const { regular, bold } = fonts();
  // Design space is landscape; the printer feeds portrait.
  const width = geometry.heightPx;
  const height = geometry.widthPx;
  const pad = Math.round(width * 0.04);

  const title = content.title.trim() || "Untitled";
  const isArt = content.template === "art";

  // The art template gives the picture the room and keeps type modest; the qr
  // template leads with the headline because that's what identifies the box.
  const titleBoxHeight = isArt
    ? Math.round(height * 0.22)
    : Math.round(height * 0.42);
  const fontSize = titleSize(title, width - pad * 2, titleBoxHeight);

  const qrSize = Math.round(height * 0.42);
  const qrSrc =
    !isArt && content.url ? await qrPngDataUrl(content.url, qrSize) : null;

  const children: unknown[] = [
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          fontSize,
          fontWeight: 700,
          lineHeight: 1.15,
          color: "#000",
          // Deliberately NO maxHeight/overflow:hidden. Clipping would silently
          // cut a box name in half; a conservative size estimate is the right
          // way to make it fit, and if it ever doesn't, it should be obvious.
          flexShrink: 0,
        },
        children: title,
      },
    },
  ];

  if (content.lines?.length) {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          marginTop: Math.round(height * 0.03),
          fontSize: Math.round(height * 0.055),
          color: "#000",
        },
        children: content.lines.slice(0, 4).map((line) => ({
          type: "div",
          props: { style: { display: "flex" }, children: line },
        })),
      },
    });
  }

  // Art fills the space between the text and the bottom row.
  if (content.artDataUrl) {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          marginTop: Math.round(height * 0.02),
        },
        children: {
          type: "img",
          props: {
            src: content.artDataUrl,
            style: {
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            },
          },
        },
      },
    });
  }

  if (qrSrc) {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          marginTop: "auto",
          alignItems: "flex-end",
        },
        children: {
          type: "img",
          props: { src: qrSrc, width: qrSize, height: qrSize },
        },
      },
    });
  }

  // satori's element type is ReactNode, but building the tree as plain objects
  // keeps this file free of JSX/React just to draw a label.
  const tree = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: pad,
        background: "#fff",
        fontFamily: "Inter",
      },
      children,
    },
  } as unknown as Parameters<typeof satori>[0];

  const svg = await satori(tree, {
    width,
    height,
    fonts: [
      { name: "Inter", data: regular, weight: 400, style: "normal" },
      { name: "Inter", data: bold, weight: 700, style: "normal" },
    ],
  } satisfies SatoriOptions);

  // Rotate into the printer's portrait feed. Greyscale, not 1-bit: the device
  // owns dithering, which depends on its head, media and speed.
  return sharp(Buffer.from(svg))
    .rotate(90)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .png()
    .toBuffer();
}
