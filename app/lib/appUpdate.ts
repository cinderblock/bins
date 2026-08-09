/**
 * Taking a new build, promptly, without eating whatever is in someone's hand.
 *
 * The app used to sit on `registerType: "prompt"` and never activate a waiting
 * worker at all, so a device kept running its precached build until somebody
 * tapped a toast. In practice phones stayed on an old build indefinitely —
 * every fix shipped was invisible to them, which is how a day got lost to
 * "are you actually deploying?". (That rule was an early implementation
 * choice, never a decision anyone asked for.)
 *
 * The policy now: **always update**. Activate the new worker the moment it's
 * ready — that alone is invisible, since the running page keeps its own chunks
 * and the server serves those from previous releases — then reload as soon as
 * reloading cannot cost anything.
 *
 * "Cannot cost anything" is deliberately conservative, and the decision is
 * kept separate from reading the DOM so it can be tested directly.
 */

/** What the page looks like, as far as interrupting someone is concerned. */
export type ActivityState = {
  /** A sheet, dialog or lightbox is open — they're partway through a task. */
  overlayOpen: boolean;
  /** Focus is in a text field; a half-typed note is the classic thing to lose. */
  focusedEditable: boolean;
  /** A camera preview is running; they're lining up a shot. */
  liveCamera: boolean;
  /** Nobody is looking, so a reload is free whatever else is true. */
  hidden: boolean;
};

/**
 * Why a reload is being held off, or null if it's free to go.
 *
 * A hidden page short-circuits everything: coming back to a fresh app is
 * indistinguishable from coming back to the old one.
 */
export function reloadBlockedBy(state: ActivityState): string | null {
  if (state.hidden) return null;
  if (state.overlayOpen) return "overlay open";
  if (state.focusedEditable) return "typing";
  if (state.liveCamera) return "camera live";
  return null;
}

function readActivity(): ActivityState {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName;
  let liveCamera = false;
  for (const video of document.querySelectorAll("video")) {
    if (video.srcObject && !video.paused) liveCamera = true;
  }
  return {
    overlayOpen: !!document.querySelector(
      ".mantine-Modal-root, .mantine-Drawer-root",
    ),
    focusedEditable:
      tag === "INPUT" || tag === "TEXTAREA" || !!el?.isContentEditable,
    liveCamera,
    hidden: document.visibilityState === "hidden",
  };
}

/** How often to re-check while something is in progress. */
const RECHECK_MS = 5_000;

let scheduled = false;

/**
 * Reload to pick up an already-activated worker, at the first moment it costs
 * nothing. Safe to call repeatedly; only the first call arms it.
 */
export function reloadWhenSafe(): void {
  if (scheduled) return;
  scheduled = true;

  const attempt = () => {
    if (reloadBlockedBy(readActivity()) === null) {
      window.location.reload();
      return;
    }
    window.setTimeout(attempt, RECHECK_MS);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") attempt();
  });
  attempt();
}
