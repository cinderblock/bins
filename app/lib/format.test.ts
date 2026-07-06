import { describe, expect, test } from "bun:test";
import { binIdFromScan } from "./format";

describe("binIdFromScan", () => {
  test("bare numbers and plain URLs (no secret)", () => {
    expect(binIdFromScan("123")).toEqual({ binId: 123, code: null });
    expect(binIdFromScan(" 123 ")).toEqual({ binId: 123, code: null });
    expect(binIdFromScan("https://host.example/123")).toEqual({
      binId: 123,
      code: null,
    });
    expect(binIdFromScan("https://host.example/123/")).toEqual({
      binId: 123,
      code: null,
    });
  });

  test("fragment carries the sticker secret (the printed format)", () => {
    expect(binIdFromScan("https://host.example/123#7HX6")).toEqual({
      binId: 123,
      code: "7HX6",
    });
    expect(binIdFromScan("https://host.example/123#code=7HX6")).toEqual({
      binId: 123,
      code: "7HX6",
    });
  });

  test("query-string forms tolerated (hand-typed / legacy)", () => {
    expect(binIdFromScan("https://host.example/123?7HX6")).toEqual({
      binId: 123,
      code: "7HX6",
    });
    expect(binIdFromScan("https://host.example/123?code=7HX6")).toEqual({
      binId: 123,
      code: "7HX6",
    });
  });

  test("non-bin values rejected", () => {
    expect(binIdFromScan("https://host.example/about")).toBeNull();
    expect(binIdFromScan("https://host.example/123abc")).toBeNull();
    expect(binIdFromScan("not a url")).toBeNull();
    expect(binIdFromScan("")).toBeNull();
  });
});
