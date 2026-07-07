/**
 * Home-screen install helpers. Installing matters beyond convenience: an
 * installed PWA's storage (the replica + unsynced photos) is far safer from
 * browser cleanup, especially on iOS.
 *
 * Chromium fires `beforeinstallprompt` exactly once, early — this module is
 * imported for its side effect from the shell so the event is never missed.
 */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    for (const listener of listeners) listener();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    for (const listener of listeners) listener();
  });
}

/** Already running as an installed app? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent)
  );
}

/** True when the browser offered a native install prompt we can replay. */
export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === "accepted") deferredPrompt = null;
  return choice.outcome === "accepted";
}

/** Subscribe to install-state changes (prompt captured / app installed). */
export function onInstallStateChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
