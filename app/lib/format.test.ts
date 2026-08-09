import { describe, expect, test } from "bun:test";
import { binIdFromScan, shortBuild } from "./format";

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

describe("shortBuild", () => {
  test("abbreviates a full sha to the 7 chars you'd paste into git", () => {
    expect(shortBuild("4c9c2129cf5ea8ba8c38f9617fe6f73dc4e6c1ab")).toBe(
      "4c9c212",
    );
  });

  test("leaves non-sha values alone", () => {
    // A local build reports "dev"; truncating that to "dev" is fine, but
    // truncating some future marker to gibberish would not be.
    expect(shortBuild("dev")).toBe("dev");
    expect(shortBuild("v1.2.3")).toBe("v1.2.3");
  });
});
