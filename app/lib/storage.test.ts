/**
 * Recognising "the device is full" across engines, because the raw failure
 * reached a real user as `Capture failed: QuotaExceededError…` and they
 * reported it by typing "Ran out of photo space" into a note.
 */
import { describe, expect, test } from "bun:test";
import {
  captureErrorMessage,
  formatBytes,
  isQuotaError,
  resetStorageWarning,
  warnIfStorageTight,
} from "./storage";

/** Stand in for navigator.storage.estimate, which bun:test has no DOM for. */
function stubEstimate(usage: number | null, quota: number | null) {
  (globalThis as { navigator?: unknown }).navigator = {
    storage: {
      estimate: async () => (usage == null ? {} : { usage, quota }),
    },
  };
}

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

describe("warnIfStorageTight", () => {
  const GB = 1024 * 1024 * 1024;

  test("warns before a capture fails, naming the percentage", async () => {
    resetStorageWarning();
    stubEstimate(0.92 * GB, GB);
    const seen: string[] = [];
    expect(await warnIfStorageTight((m) => seen.push(m))).toBe(true);
    expect(seen[0]).toContain("92%");
    // The actionable part: syncing is what frees space.
    expect(seen[0]).toContain("Sync");
  });

  test("stays quiet with room to spare", async () => {
    resetStorageWarning();
    stubEstimate(0.4 * GB, GB);
    const seen: string[] = [];
    expect(await warnIfStorageTight((m) => seen.push(m))).toBe(false);
    expect(seen).toHaveLength(0);
  });

  test("warns only once a session — repeated, it becomes wallpaper", async () => {
    resetStorageWarning();
    stubEstimate(0.99 * GB, GB);
    const seen: string[] = [];
    expect(await warnIfStorageTight((m) => seen.push(m))).toBe(true);
    expect(await warnIfStorageTight((m) => seen.push(m))).toBe(false);
    expect(seen).toHaveLength(1);
  });

  test("stays quiet when the browser won't report a quota", async () => {
    // Safari often refuses; guessing would mean crying wolf on every capture.
    resetStorageWarning();
    stubEstimate(500 * 1024 * 1024, null);
    const seen: string[] = [];
    expect(await warnIfStorageTight((m) => seen.push(m))).toBe(false);
  });
});
