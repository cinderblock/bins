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
