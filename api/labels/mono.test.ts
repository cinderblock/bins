import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import {
  DEFAULT_THRESHOLD,
  MAX_THRESHOLD,
  MIN_THRESHOLD,
  fitMonochrome,
  toMonochrome,
  toSource,
} from "./mono";

/** Every channel value of every pixel, as decoded from the output. */
async function pixels(png: Buffer) {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

describe("monochrome line art", () => {
  test("colour the model was told not to use comes out black or white", async () => {
    // The real failure: green terminal blocks, red wires, on white.
    const coloured = await sharp({
      create: { width: 60, height: 40, channels: 3, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="60" height="40"><rect x="0" y="0" width="20" height="40" fill="#2e7d32"/><rect x="20" y="0" width="20" height="40" fill="#e53935"/><rect x="40" y="0" width="20" height="40" fill="#fff59d"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .jpeg()
      .toBuffer();
    const out = await toMonochrome(coloured);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    // One channel in the file: no colour can survive, not merely "looks grey".
    expect(meta.channels).toBe(1);
    const { data, info } = await pixels(out);
    for (const value of data) expect(value === 0 || value === 255).toBe(true);
    // Dark green goes black, pale yellow white: luminance decides, not hue.
    const at = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels];
    expect(at(10, 10)).toBe(0);
    expect(at(50, 10)).toBe(255);
  });

  test("transparency becomes paper, not ink", async () => {
    const clear = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const { data } = await pixels(await toMonochrome(clear));
    for (const value of data) expect(value).toBe(255);
  });

  test("resizing happens before the cut, so the result is still two-tone", async () => {
    const grey = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="100" height="100"><line x1="0" y1="0" x2="100" y2="100" stroke="black" stroke-width="3"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const { data, info } = await pixels(
      await toMonochrome(grey, { resize: { width: 37, height: 37 } }),
    );
    expect(info.width).toBe(37);
    expect(info.height).toBe(37);
    for (const value of data) expect(value === 0 || value === 255).toBe(true);
    // The line survives the downscale.
    expect(data.some((value) => value === 0)).toBe(true);
  });

  test("the cut moves: a dark fill that prints black at the default goes white below it", async () => {
    // The real case: a dark-green PCB (luminance ~80) printed as a solid
    // black slab. A lower cut keeps the black outlines and frees the board.
    const board = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="40" height="20"><rect x="0" y="0" width="20" height="20" fill="rgb(80,80,80)"/><rect x="20" y="0" width="20" height="20" fill="black"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const at = async (png: Buffer, x: number) => {
      const { data, info } = await pixels(png);
      return data[(10 * info.width + x) * info.channels];
    };
    const normal = await toMonochrome(board);
    expect(await at(normal, 5)).toBe(0);
    const lighter = await toMonochrome(board, { threshold: 64 });
    expect(await at(lighter, 5)).toBe(255);
    // The outlines (true black) survive any cut a person can pick.
    const lightest = await toMonochrome(board, { threshold: 0 });
    expect(await at(lightest, 30)).toBe(0);
    expect(DEFAULT_THRESHOLD).toBeGreaterThan(MIN_THRESHOLD);
    expect(DEFAULT_THRESHOLD).toBeLessThan(MAX_THRESHOLD);
  });
});

describe("filling the label", () => {
  /** A 20px black square in the middle of a 300x200 sheet of white. */
  async function smallSubject(): Promise<Buffer> {
    return sharp({
      create: { width: 300, height: 200, channels: 3, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="300" height="200"><rect x="140" y="90" width="20" height="20" fill="black"/></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .jpeg()
      .toBuffer();
  }

  test("the source keeps the drawing and drops the empty paper around it", async () => {
    const source = await toSource(await smallSubject());
    const meta = await sharp(source).metadata();
    expect(meta.channels).toBe(1);
    // Trimmed to the square, give or take JPEG fuzz at its edge.
    expect(meta.width).toBeLessThan(30);
    expect(meta.height).toBeLessThan(30);
    // Proportions kept: the square stays square.
    expect(
      Math.abs((meta.width ?? 0) - (meta.height ?? 0)),
    ).toBeLessThanOrEqual(2);
  });

  test("a small subject scales up into the box instead of floating in white", async () => {
    const fitted = await fitMonochrome(
      await smallSubject(),
      { width: 400, height: 300 },
      100,
    );
    // Untrimmed, the 300x200 sheet would fit at 400x266 with the square a
    // tiny speck in it. Trimmed, the square itself fills the height.
    expect(fitted.height).toBe(300);
    const { data } = await pixels(fitted.png);
    const ink = data.filter((v) => v === 0).length / data.length;
    expect(ink).toBeGreaterThan(0.8);
  });

  test("a blank drawing comes back untrimmed rather than failing", async () => {
    const blank = await sharp({
      create: { width: 30, height: 20, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const meta = await sharp(await toSource(blank)).metadata();
    expect(meta.width).toBe(30);
    expect(meta.height).toBe(20);
  });
});
