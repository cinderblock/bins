/**
 * The shake detector, on recorded-shape motion. A false negative means the
 * feature silently doesn't work; a false positive pops a sheet in the middle of
 * carrying a box. Both directions are pinned here.
 */
import { describe, expect, test } from "bun:test";
import { type Sample, createShakeDetector } from "./shake";

/** Samples at 60 Hz of a sine wave along one axis. */
function wave(
  hz: number,
  peak: number,
  seconds: number,
  axis: "x" | "y" = "x",
) {
  const samples: Sample[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    const t = (i / 60) * 1000;
    const value = peak * Math.sin(2 * Math.PI * hz * (t / 1000));
    samples.push({ x: 0, y: 0, z: 0, t, [axis]: value });
  }
  return samples;
}

function fires(samples: Sample[]): number {
  const detect = createShakeDetector();
  return samples.filter((s) => detect(s)).length;
}

describe("shake detection", () => {
  test("a brisk shake fires once, not once per swing", () => {
    expect(fires(wave(4, 25, 1.5))).toBe(1);
  });

  test("walking does not fire: too weak", () => {
    expect(fires(wave(2, 6, 5))).toBe(0);
  });

  test("a hard knock does not fire: strong, but it doesn't reverse enough", () => {
    expect(fires(wave(8, 30, 0.15))).toBe(0);
  });

  test("slow heavy swings don't add up across the window", () => {
    expect(fires(wave(0.5, 25, 8))).toBe(0);
  });

  test("a second shake fires after the cooldown", () => {
    const first = wave(4, 25, 1);
    const second = wave(4, 25, 1).map((s) => ({ ...s, t: s.t + 5000 }));
    expect(fires([...first, ...second])).toBe(2);
  });
});
