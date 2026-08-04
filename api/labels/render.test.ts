/**
 * Label rendering tests.
 *
 * These run anywhere — no native canvas, no system fonts. That is the whole
 * reason satori was chosen over a canvas: the label is a pure function of its
 * content, so it can be tested on a dev box and trusted on a print server.
 */
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { renderLabel } from "./render";
import { type LabelGeometry, parseLabelSize } from "./spec";

const FOUR_BY_SIX: LabelGeometry = { widthPx: 812, heightPx: 1218, dpi: 203 };

describe("label size parsing", () => {
  test("inches @ dpi becomes pixel geometry", () => {
    expect(parseLabelSize("4x6@203")).toEqual(FOUR_BY_SIX);
    // 2.25x1.25 @ 300 — a common address-label stock, non-integer inches.
    expect(parseLabelSize("2.25x1.25@300")).toEqual({
      widthPx: 675,
      heightPx: 375,
      dpi: 300,
    });
  });

  test("garbage is rejected rather than guessed at", () => {
    for (const bad of [
      undefined,
      "",
      "4x6",
      "4@203",
      "0x6@203",
      "4x6@0",
      "-4x6@203",
      "4 x 6 @ 203",
      "axb@203",
    ]) {
      expect(parseLabelSize(bad)).toBeNull();
    }
  });
});

describe("label rendering", () => {
  test("renders at the printer's portrait geometry", async () => {
    const png = await renderLabel(
      { template: "qr", title: "Test Fixtures", url: "HTTPS://EXAMPLE/193" },
      FOUR_BY_SIX,
    );
    const meta = await sharp(png).metadata();
    // Portrait as the printer feeds it, NOT the landscape design space.
    expect(meta.width).toBe(FOUR_BY_SIX.widthPx);
    expect(meta.height).toBe(FOUR_BY_SIX.heightPx);
    expect(meta.format).toBe("png");
  });

  test("output is deterministic — the point of bundling the font", async () => {
    const content = {
      template: "qr" as const,
      title: "Test Fixtures",
      url: "HTTPS://EXAMPLE/193",
    };
    const a = await renderLabel(content, FOUR_BY_SIX);
    const b = await renderLabel(content, FOUR_BY_SIX);
    // Byte-identical. If this ever fails, something is resolving a font (or a
    // clock, or a random) at render time and the label is no longer a pure
    // function of its content.
    expect(Buffer.compare(a, b)).toBe(0);
  });

  test("a long title shrinks instead of being clipped", async () => {
    const short = await renderLabel(
      { template: "qr", title: "Nuts", url: "HTTPS://EXAMPLE/1" },
      FOUR_BY_SIX,
    );
    const long = await renderLabel(
      {
        template: "qr",
        title: "Assorted Pneumatic Fittings And Spare Manifold Hardware",
        url: "HTTPS://EXAMPLE/1",
      },
      FOUR_BY_SIX,
    );
    // Both fill the same canvas; the long one just uses more ink for text.
    const [sm, lm] = await Promise.all([
      sharp(short).metadata(),
      sharp(long).metadata(),
    ]);
    expect(sm.height).toBe(lm.height);
    // A clipped render would drop content; more text must mean more dark
    // pixels, never fewer.
    const ink = async (png: Buffer) => {
      const { data } = await sharp(png)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let dark = 0;
      for (let i = 0; i < data.length; i++) if ((data[i] ?? 255) < 128) dark++;
      return dark;
    };
    expect(await ink(long)).toBeGreaterThan(await ink(short));
  });

  test("the art template draws no QR even when a url is supplied", async () => {
    const qr = await renderLabel(
      { template: "qr", title: "Box", url: "HTTPS://EXAMPLE/1" },
      FOUR_BY_SIX,
    );
    const art = await renderLabel(
      { template: "art", title: "Box", url: "HTTPS://EXAMPLE/1" },
      FOUR_BY_SIX,
    );
    // Decorative stickers go on containers that already carry their own
    // identifier; a second scannable code would be redundant.
    expect(Buffer.compare(qr, art)).not.toBe(0);
    const ink = async (png: Buffer) => {
      const { data } = await sharp(png)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let dark = 0;
      for (let i = 0; i < data.length; i++) if ((data[i] ?? 255) < 128) dark++;
      return dark;
    };
    // Same words, but one has a QR block and the other doesn't.
    expect(await ink(qr)).toBeGreaterThan(await ink(art));
  });

  test("an empty title still renders something printable", async () => {
    const png = await renderLabel(
      { template: "qr", title: "   " },
      FOUR_BY_SIX,
    );
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(FOUR_BY_SIX.widthPx);
  });
});

/**
 * Decode a QR straight out of a rendered label.
 *
 * zxing's wasm build reaches for a couple of DOM globals purely to describe
 * where it found a barcode. Nothing here needs a real DOM, so a minimal shim
 * lets the decoder run under Bun.
 */
class DOMRectShim {
  x: number;
  y: number;
  width: number;
  height: number;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
  get top() {
    return this.y;
  }
  get left() {
    return this.x;
  }
  get right() {
    return this.x + this.width;
  }
  get bottom() {
    return this.y + this.height;
  }
  toJSON() {
    return { ...this };
  }
}

async function decodeQr(png: Buffer): Promise<string[]> {
  (globalThis as Record<string, unknown>).DOMRectReadOnly ??= DOMRectShim;
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  // Copy into a plain Uint8Array: Buffer's ArrayBufferLike isn't a BlobPart.
  const bytes = new Uint8Array(png);
  const found = await detector.detect(new Blob([bytes], { type: "image/png" }));
  return found.map((f) => f.rawValue);
}

describe("the printed QR", () => {
  test("actually scans, and points at the box it labels", async () => {
    // The single most important property of a label: a sticker that scans to
    // the wrong box — or doesn't scan — is worse than no sticker at all. This
    // decodes the real rendered pixels, so it also catches a QR rendered too
    // small, too dense, or mangled by the layout.
    const url = "HTTPS://STORE.EXAMPLE.ORG/193#7HX6";
    const png = await renderLabel(
      { template: "qr", title: "Test Fixtures", url },
      FOUR_BY_SIX,
    );
    expect(await decodeQr(png)).toEqual([url]);
  });

  test("survives a long title squeezing the layout", async () => {
    const url = "HTTPS://STORE.EXAMPLE.ORG/1042";
    const png = await renderLabel(
      {
        template: "qr",
        title: "Assorted Pneumatic Fittings And Spare Manifold Hardware",
        url,
        lines: ["Shelf H4"],
      },
      FOUR_BY_SIX,
    );
    expect(await decodeQr(png)).toEqual([url]);
  });

  test("the art template prints no scannable code at all", async () => {
    const png = await renderLabel(
      { template: "art", title: "Costumes", url: "HTTPS://EXAMPLE/1" },
      FOUR_BY_SIX,
    );
    expect(await decodeQr(png)).toEqual([]);
  });
});
