import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { toMonochrome } from "./mono";

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
      await toMonochrome(grey, { width: 37, height: 37 }),
    );
    expect(info.width).toBe(37);
    expect(info.height).toBe(37);
    for (const value of data) expect(value === 0 || value === 255).toBe(true);
    // The line survives the downscale.
    expect(data.some((value) => value === 0)).toBe(true);
  });
});
