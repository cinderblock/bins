/**
 * The guard deciding whether reloading for a new build would interrupt
 * someone. Wrong in either direction is costly: too eager eats a half-typed
 * note, too shy leaves a device on an old build forever — and it was the shy
 * failure that actually happened, for weeks, invisibly.
 */
import { describe, expect, test } from "bun:test";
import { type ActivityState, reloadBlockedBy } from "./appUpdate";

const idle: ActivityState = {
  overlayOpen: false,
  focusedEditable: false,
  liveCamera: false,
  hidden: false,
};

describe("reloadBlockedBy", () => {
  test("an idle, visible page reloads immediately", () => {
    expect(reloadBlockedBy(idle)).toBeNull();
  });

  test("holds off while a sheet or dialog is open", () => {
    expect(reloadBlockedBy({ ...idle, overlayOpen: true })).toBe(
      "overlay open",
    );
  });

  test("holds off while a text field has focus", () => {
    expect(reloadBlockedBy({ ...idle, focusedEditable: true })).toBe("typing");
  });

  test("holds off while a camera preview is live", () => {
    expect(reloadBlockedBy({ ...idle, liveCamera: true })).toBe("camera live");
  });

  test("a hidden page is always free, whatever else is going on", () => {
    // The most valuable case: backgrounding the app is how most devices will
    // actually take an update, and it can interrupt nobody by definition.
    expect(
      reloadBlockedBy({
        overlayOpen: true,
        focusedEditable: true,
        liveCamera: true,
        hidden: true,
      }),
    ).toBeNull();
  });
});
