/**
 * Shared desktop/mobile layout conventions. The app is mobile-first; these
 * keep the same layouts usable when the viewport is a desktop window.
 */

/** List/detail pages center their content at this width on wide viewports. */
export const PAGE_MAXW = 640;

/**
 * At or below Mantine's `sm` breakpoint the edit surfaces present as bottom
 * drawers (thumb reach); above it they present as centered modals.
 */
export const PHONE_MEDIA = "(max-width: 48em)";

/**
 * Device-type heuristic (not window size): a device with a mouse and hover
 * is a desktop whose camera faces the user — scanning is opt-in there.
 */
export const DESKTOP_MEDIA = "(hover: hover) and (pointer: fine)";

/**
 * Finger-sized treatment: a phone-width window OR any coarse pointer. Wider
 * than PHONE_MEDIA on purpose — a tablet in landscape has a desktop-sized
 * viewport but still needs targets you can hit with a thumb, and no hover to
 * discover things with.
 */
export const TOUCH_MEDIA = `${PHONE_MEDIA}, (pointer: coarse)`;

/** Minimum comfortable tap target (px) — iOS HIG's 44pt. */
export const TOUCH_TARGET = 44;

/** Height of the bin page's fixed bottom ActionBar. */
export const ACTION_BAR_HEIGHT = 88;

/**
 * How far bottom-center toasts sit above the viewport bottom. They'd otherwise
 * land ON the bin page's ActionBar and the scanner's bottom controls — which
 * matters most for a toast carrying a button (the delete Undo), where the
 * button lands exactly where "Note" is and a miss is a mis-tap on the app's
 * primary surface.
 *
 * The `+ xl` is not just breathing room: Mantine's notification renders ~20px
 * past the bottom of its own fixed container, so clearing the bar takes more
 * than the bar's height. Measured in a browser (md left a 2px hairline, xl
 * leaves ~18px) — re-measure rather than eyeball it if this regresses.
 */
export const TOAST_BOTTOM = `calc(${ACTION_BAR_HEIGHT}px + env(safe-area-inset-bottom) + var(--mantine-spacing-xl))`;
