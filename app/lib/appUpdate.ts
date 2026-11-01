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
  /** A field holds something the person typed and nothing has taken it yet. */
  unsavedInput: boolean;
  /** Nobody is looking, so a reload interrupts nothing they're doing. */
  hidden: boolean;
};

/**
 * Why a reload is being held off, or null if it's free to go.
 *
 * Unsaved work comes first, ahead of `hidden`: switching apps to copy something
 * into a half-written note is not leaving the note, and a page that reloaded
 * behind them would throw it away. A sheet counts as unsaved work too, because
 * plenty of them hold choices that were never typed into a field. Everything
 * else is only about not interrupting, so a hidden page is free of it.
 */
export function reloadBlockedBy(state: ActivityState): string | null {
  if (state.unsavedInput) return "unsaved input";
  if (state.overlayOpen) return "overlay open";
  if (state.hidden) return null;
  if (state.focusedEditable) return "typing";
  if (state.liveCamera) return "camera live";
  return null;
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Value each field held when the person started on it. */
const baselines = new WeakMap<Element, string>();
const edited = new Set<Element>();

function isField(el: EventTarget | null): el is Field {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function fieldValue(el: Element): string {
  if (el instanceof HTMLInputElement) {
    return el.type === "checkbox" || el.type === "radio"
      ? String(el.checked)
      : el.value;
  }
  if (isField(el)) return el.value;
  return el.textContent ?? "";
}

/**
 * Notice typing anywhere in the app, with no form having to opt in. That matters
 * because React state can't be read from out here, and a form nobody remembered
 * to register would be exactly the one that loses someone's work.
 */
export function installUnsavedTracking(): void {
  const remember = (event: Event) => {
    const el = event.target as HTMLElement | null;
    if (!el) return;
    if ((isField(el) || el.isContentEditable) && !baselines.has(el)) {
      baselines.set(el, fieldValue(el));
    }
  };
  const mark = (event: Event) => {
    const el = event.target as HTMLElement | null;
    if (el && (isField(el) || el.isContentEditable)) edited.add(el);
  };
  document.addEventListener("focusin", remember, true);
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
}

/**
 * Is anything typed and still sitting in a field? A field that left the page
 * has been saved or abandoned, one back at its starting value has nothing to
 * lose, and `data-reload-safe` marks throwaway input such as a search box.
 */
function hasUnsavedInput(): boolean {
  for (const el of edited) {
    if (!el.isConnected) {
      edited.delete(el);
      continue;
    }
    if (el.closest("[data-reload-safe]")) continue;
    if (fieldValue(el) !== (baselines.get(el) ?? "")) return true;
  }
  return false;
}

function readActivity(): ActivityState {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName;
  let liveCamera = false;
  for (const video of document.querySelectorAll("video")) {
    if (video.srcObject && !video.paused) liveCamera = true;
  }
  return {
    // The content element, not the root: Mantine leaves a CLOSED sheet's root
    // in the page, which made every page with a sheet on it look busy.
    overlayOpen: !!document.querySelector(
      ".mantine-Modal-content, .mantine-Drawer-content",
    ),
    focusedEditable:
      tag === "INPUT" || tag === "TEXTAREA" || !!el?.isContentEditable,
    liveCamera,
    unsavedInput: hasUnsavedInput(),
    hidden: document.visibilityState === "hidden",
  };
}

/** What is holding a reload right now, for diagnosing a device stuck on an old build. */
export function currentReloadBlocker(): string | null {
  return reloadBlockedBy(readActivity());
}

let updateCheck: (() => void) | null = null;

/** The service worker's "is there a new build?", once it has registered. */
export function registerUpdateCheck(check: () => void): void {
  updateCheck = check;
}

/**
 * The server has something this page doesn't, so look now rather than at the
 * next timer. With no worker (dev, or a browser without them) there is nothing
 * to ask, and a plain reload is the update.
 */
export function requestUpdateCheck(): void {
  if (updateCheck) updateCheck();
  else reloadWhenSafe();
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
    if (currentReloadBlocker() === null) {
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
