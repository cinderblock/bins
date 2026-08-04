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
