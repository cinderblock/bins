/**
 * Recognising "the device is full" across engines, because the raw failure
 * reached a real user as `Capture failed: QuotaExceededError…` and they
 * reported it by typing "Ran out of photo space" into a note.
 */
import { describe, expect, test } from "bun:test";
import { captureErrorMessage, formatBytes, isQuotaError } from "./storage";

describe("isQuotaError", () => {
  test("recognises the standard name", () => {
    const err = new Error("nope");
    err.name = "QuotaExceededError";
    expect(isQuotaError(err)).toBe(true);
  });

  test("recognises WebKit's bare code 22", () => {
    // Safari has historically thrown a DOMException with no useful name —
    // and Safari is where a camp phone is most likely to hit this.
    expect(isQuotaError({ code: 22, message: "" })).toBe(true);
  });

  test("recognises Firefox's name", () => {
    expect(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
  });

  test("leaves unrelated failures alone", () => {
    expect(isQuotaError(new Error("camera busy"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("captureErrorMessage", () => {
  test("explains a full device and how to fix it", () => {
    const err = new Error("");
    err.name = "QuotaExceededError";
    const msg = captureErrorMessage(err);
    expect(msg).toContain("out of storage");
    // The actionable part matters more than the diagnosis.
    expect(msg.toLowerCase()).toContain("upload");
  });

  test("keeps the raw error for anything else, so it stays diagnosable", () => {
    expect(captureErrorMessage(new Error("camera busy"))).toContain(
      "camera busy",
    );
  });
});

describe("formatBytes", () => {
  test("scales to readable units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
});
