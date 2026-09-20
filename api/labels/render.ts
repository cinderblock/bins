/**
 * Label rendering: content -> PNG, entirely inside bins.
 *
 * satori + sharp rather than a canvas, deliberately. satori converts text to
 * vector PATHS using a font buffer bundled with the app, so the rasteriser
 * never resolves a font by name. That means a label looks identical on a dev
 * box, in CI, and on any host — no native module to build, and none of the
 * "missing system font renders tofu" failures that plague server-side canvas.
 *
 * Layout follows the operator's label generator, which is the look people
 * already know from their other stickers: everything LANDSCAPE (long axis
 * horizontal, which is how the design reads) and rotated 90° at the end for
 * the printer's portrait feed.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ TITLE, big, across the top               │
 *   │ subtext line     ┌───────────────────────┐│
 *   │ subtext line     │                       ││
 *   │                  │   drawing, filling    ││
 *   │ ┌──────┐         │   everything right of ││
 *   │ │  QR  │         │   the left column     ││
 *   │ └──────┘         └───────────────────────┘│
 *   └──────────────────────────────────────────┘
 *
 * Tight padding (a tenth of an inch), the subtext under the title on the
 * left, the QR in the bottom-left corner, and the drawing given the whole of
 * the rest — to the right of the left column, from the title down to the
 * bottom edge. The drawing is the point of the label; it gets the room.
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
 * Inter Bold mixed-case mean advance / em. Erring HIGH is the safe direction:
 * it predicts more lines than reality, so sizes chosen from it are
 * conservative and blocks fit.
 */
const AVG_ADVANCE = 0.58;
/** A line occupies more than its font-size — ascender, descender, line gap. */
const LINE_BOX = 1.15;

/**
 * Fit the headline: start at the generator's size (half an inch) and shrink
 * only when the title would need more than `maxLines`. satori still does the
 * real wrapping — this only picks a size that leaves it enough room. Returns
 * the size and the number of lines it predicts, which the layout below needs
 * to know how tall the title block is.
 */
function titleFit(
  title: string,
  widthPx: number,
  startPx: number,
  maxLines: number,
): { fontSize: number; lines: number } {
  const min = Math.round(startPx * 0.35);
  for (let size = startPx; size > min; size -= 4) {
    const perLine = Math.max(1, Math.floor(widthPx / (size * AVG_ADVANCE)));
    const lines = Math.ceil(title.length / perLine);
    if (lines <= maxLines) return { fontSize: size, lines };
  }
  const perLine = Math.max(1, Math.floor(widthPx / (min * AVG_ADVANCE)));
  return { fontSize: min, lines: Math.ceil(title.length / perLine) };
}

/**
 * Pixel size of an artwork as supplied, for fitting it into its box.
 *
 * Throws rather than returning null: a label that silently comes out without
 * the drawing someone chose is the worst outcome — they approve a preview
 * that looks whole, print stock, and only notice later. Whoever calls this
 * turns the throw into something the person can read.
 */
async function imageSize(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("drawing is not a data URL");
  const meta = await sharp(
    Buffer.from(dataUrl.slice(comma + 1), "base64"),
  ).metadata();
  if (!meta.width || !meta.height)
    throw new Error("drawing has no readable dimensions");
  return { width: meta.width, height: meta.height };
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
  const { dpi } = geometry;
  // A tenth of an inch. The generator uses 20px at 203dpi; same thing.
  const pad = Math.round(dpi * 0.1);
  const inner = width - pad * 2;

  const title = content.title.trim() || "Untitled";
  const isArt = content.template === "art";
  const lines = (content.lines ?? []).slice(0, 4);

  // Headline: half an inch, at most two lines, shrinking only if it must.
  const fit = titleFit(title, inner, Math.round(dpi * 0.5), 2);
  const titleHeight = Math.round(fit.lines * fit.fontSize * LINE_BOX);

  // Left column: subtext, then the QR at the bottom. Its width is whichever
  // is wider, the code or the longest line — capped so the drawing always
  // keeps most of the label.
  const lineSize = Math.round(dpi * 0.25);
  const qrSize = isArt ? 0 : Math.round(height * 0.36);
  const longestLine = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const textWidth = Math.ceil(longestLine * lineSize * 0.55);
  const hasLeft = qrSize > 0 || lines.length > 0;
  const leftWidth = hasLeft
    ? Math.min(Math.max(qrSize, textWidth), Math.round(inner * 0.45))
    : 0;
  const gap = hasLeft ? Math.round(pad / 2) : 0;

  // The drawing's box: everything right of the left column, from just under
  // the title to the bottom edge. Sized explicitly because satori will not
  // shrink an image to fit a flex box on its own.
  const artBoxW = inner - leftWidth - gap;
  const artBoxH = height - pad * 2 - titleHeight - Math.round(pad / 4);
  let art: { src: string; width: number; height: number } | null = null;
  if (content.artDataUrl) {
    const size = await imageSize(content.artDataUrl);
    // A box too small to draw in would scale the picture to nothing, which
    // looks exactly like no picture at all. Say so instead.
    if (artBoxW < 16 || artBoxH < 16) {
      throw new Error(
        `no room for the drawing on this label (${artBoxW}x${artBoxH}px left after the title and QR)`,
      );
    }
    const scale = Math.min(artBoxW / size.width, artBoxH / size.height, 4);
    art = {
      src: content.artDataUrl,
      width: Math.max(1, Math.floor(size.width * scale)),
      height: Math.max(1, Math.floor(size.height * scale)),
    };
  }

  const qrSrc =
    !isArt && content.url ? await qrPngDataUrl(content.url, qrSize) : null;

  const leftColumn = hasLeft
    ? {
        type: "div",
        props: {
          style: {
            display: "flex",
            flexDirection: "column",
            width: leftWidth,
            flexShrink: 0,
            height: "100%",
          },
          children: [
            ...lines.map((line) => ({
              type: "div",
              props: {
                style: {
                  display: "flex",
                  fontSize: lineSize,
                  lineHeight: 1.25,
                  color: "#000",
                },
                children: line,
              },
            })),
            ...(qrSrc
              ? [
                  {
                    type: "div",
                    props: {
                      style: { display: "flex", marginTop: "auto" },
                      children: {
                        type: "img",
                        props: { src: qrSrc, width: qrSize, height: qrSize },
                      },
                    },
                  },
                ]
              : []),
          ],
        },
      }
    : null;

  const artColumn = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        marginLeft: gap,
        height: "100%",
      },
      children: art
        ? {
            type: "img",
            props: { src: art.src, width: art.width, height: art.height },
          }
        : null,
    },
  };

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
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: fit.fontSize,
              fontWeight: 700,
              lineHeight: LINE_BOX,
              color: "#000",
              // Deliberately NO maxHeight/overflow:hidden. Clipping would
              // silently cut a box name in half; a conservative size estimate
              // is the right way to make it fit, and if it ever doesn't, it
              // should be obvious.
              flexShrink: 0,
            },
            children: title,
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "row",
              flexGrow: 1,
              marginTop: Math.round(pad / 4),
              minHeight: 0,
            },
            children: [leftColumn, artColumn].filter(Boolean),
          },
        },
      ],
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
