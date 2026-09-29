import { describe, expect, test } from "bun:test";
import { formatLength, parseLength } from "./lengths";

describe("formatLength", () => {
  test("feet and inches, to the half inch", () => {
    expect(formatLength(3810, "ft")).toBe("12′ 6″");
    expect(formatLength(304.8 * 4, "ft")).toBe("4′");
    expect(formatLength(114.3, "ft")).toBe("4.5″");
    // 11.99 inches rounds to a foot, not 0′ 12″.
    expect(formatLength(304.5, "ft")).toBe("1′");
  });

  test("metres, with centimetres under one", () => {
    expect(formatLength(3750, "m")).toBe("3.75 m");
    expect(formatLength(450, "m")).toBe("45 cm");
    expect(formatLength(-1200, "m")).toBe("−1.2 m");
  });
});

describe("parseLength", () => {
  test("every way people write feet and inches", () => {
    for (const text of [`12' 6"`, "12ft 6in", "12′6″", "12 feet 6 inches"])
      expect(parseLength(text, "m")).toBeCloseTo(3810, 5);
    expect(parseLength(`18"`, "m")).toBeCloseTo(457.2, 5);
    expect(parseLength("4'", "m")).toBeCloseTo(1219.2, 5);
  });

  test("metric with explicit units", () => {
    expect(parseLength("150 cm", "ft")).toBe(1500);
    expect(parseLength("3.2m", "ft")).toBe(3200);
    expect(parseLength("900mm", "ft")).toBe(900);
  });

  test("a bare number is the preferred unit's main measure", () => {
    expect(parseLength("4.5", "m")).toBe(4500);
    expect(parseLength("10", "ft")).toBeCloseTo(3048, 5);
    expect(parseLength("-2", "m")).toBe(-2000);
  });

  test("nonsense is null, not zero", () => {
    expect(parseLength("", "ft")).toBeNull();
    expect(parseLength("about four", "ft")).toBeNull();
    expect(parseLength("4 parsecs", "ft")).toBeNull();
  });
});
