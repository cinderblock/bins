/**
 * Hold the app in portrait.
 *
 * Reported from the field: bending down to scan a low box tips the phone past
 * the rotation threshold, the layout reflows to landscape mid-scan, and the
 * thing you were aiming at moves. The manifest already declares
 * `orientation: "portrait"`, but that is only a hint an installed app may
 * honour — it does nothing in a browser tab, and nothing at all while the app
 * is already running.
 *
 * The Screen Orientation API is the part that actually holds. It is best
 * effort by design:
 *   - Chromium on Android, installed (standalone): works.
 *   - Browser tabs: usually rejects without fullscreen — expected, not an error.
 *   - iOS (any browser, since they are all WebKit): unsupported entirely.
 * So every failure path is swallowed. There is nothing to report to the user
 * and nothing they could do about it.
 */

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "portrait" | "landscape") => Promise<void>;
};

export function lockPortrait(): void {
  try {
    const orientation = screen?.orientation as LockableOrientation | undefined;
    // A promise rejection here is the normal outcome in a browser tab; catch
    // it so it never surfaces as an unhandled rejection (which the stale-build
    // detector would otherwise have to reason about).
    void orientation?.lock?.("portrait").catch(() => {});
  } catch {
    // Older engines throw synchronously instead of rejecting.
  }
}
