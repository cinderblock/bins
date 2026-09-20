import { describe, expect, test } from "bun:test";
import { binIdFromScan, placeCodeFromScan, shortBuild } from "./format";

describe("binIdFromScan", () => {
  test("bare numbers and plain URLs (no secret)", () => {
    expect(binIdFromScan("123")).toEqual({
      binId: 123,
      handle: null,
      code: null,
    });
    expect(binIdFromScan(" 123 ")).toEqual({
      binId: 123,
      handle: null,
      code: null,
    });
    expect(binIdFromScan("https://host.example/123")).toEqual({
      binId: 123,
      handle: null,
      code: null,
    });
    expect(binIdFromScan("https://host.example/123/")).toEqual({
      binId: 123,
      handle: null,
      code: null,
    });
  });

  test("fragment carries the sticker secret (the printed format)", () => {
    expect(binIdFromScan("https://host.example/123#7HX6")).toEqual({
      binId: 123,
      handle: null,
      code: "7HX6",
    });
    expect(binIdFromScan("https://host.example/123#code=7HX6")).toEqual({
      binId: 123,
      handle: null,
      code: "7HX6",
    });
  });

  test("query-string forms tolerated (hand-typed / legacy)", () => {
    expect(binIdFromScan("https://host.example/123?7HX6")).toEqual({
      binId: 123,
      handle: null,
      code: "7HX6",
    });
    expect(binIdFromScan("https://host.example/123?code=7HX6")).toEqual({
      binId: 123,
      handle: null,
      code: "7HX6",
    });
  });

  test("handles: bare, in a URL, upper-cased as printed, with a code", () => {
    const handle = "9b2c6d1e-1f3a-4c5b-8d7e-0123456789ab";
    expect(binIdFromScan(handle)).toEqual({ binId: null, handle, code: null });
    expect(binIdFromScan(`https://host.example/b/${handle}`)).toEqual({
      binId: null,
      handle,
      code: null,
    });
    // Sticker URLs are upper-cased for QR density; the handle comes back in
    // its stored (lower) case so a replica lookup matches.
    expect(
      binIdFromScan(`HTTPS://HOST.EXAMPLE/B/${handle.toUpperCase()}#7HX6`),
    ).toEqual({ binId: null, handle, code: "7HX6" });
    expect(binIdFromScan("https://host.example/b/not-a-handle")).toBeNull();
  });

  test("non-bin values rejected", () => {
    expect(binIdFromScan("https://host.example/about")).toBeNull();
    expect(binIdFromScan("https://host.example/123abc")).toBeNull();
    expect(binIdFromScan("not a url")).toBeNull();
    expect(binIdFromScan("")).toBeNull();
  });
});

describe("placeCodeFromScan", () => {
  test("a bare printed string is the code — the stickers have no prefix", () => {
    // These exist on the shelves already and are not getting reprinted, so
    // whatever they say IS the code.
    expect(placeCodeFromScan("H4K9")).toBe("H4K9");
    expect(placeCodeFromScan("	 x7-22b  ")).toBe("x7-22b");
  });

  test("a URL contributes its last path segment, so both forms agree", () => {
    expect(placeCodeFromScan("https://store.example/s/H4K9")).toBe("H4K9");
    expect(placeCodeFromScan("https://store.example/s/H4K9/")).toBe("H4K9");
    expect(placeCodeFromScan("https://store.example/s/a%20b")).toBe("a b");
  });

  test("implausible values are not shelves", () => {
    // A stray QR in the camera's view must not be read as a shelf.
    expect(placeCodeFromScan("")).toBeNull();
    expect(placeCodeFromScan("   ")).toBeNull();
    expect(placeCodeFromScan("A")).toBeNull();
    expect(placeCodeFromScan("x".repeat(65))).toBeNull();
    // A link to a site, with nothing identifying a shelf in it.
    expect(placeCodeFromScan("https://example.com")).toBeNull();
  });

  test("matching ignores case and surrounding space", () => {
    // Same sticker, read twice, must resolve to one shelf.
    const a = placeCodeFromScan(" h4k9 ");
    const b = placeCodeFromScan("H4K9");
    expect(a?.toLowerCase()).toBe(b?.toLowerCase() ?? "");
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
