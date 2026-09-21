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

/**
 * Wide pages (settings, admin) stop growing here. Their cards are laid out
 * in columns by `CardGrid`, so this is a readable-line-length ceiling on the
 * whole board rather than on one column.
 */
export const WIDE_MAXW = 1240;

/**
 * Narrowest a card column may get before `CardGrid` drops to fewer columns.
 * Sized so a Mantine input with a label and a description still reads.
 */
export const CARD_MINW = 400;

/** Put on a container whose HOVER_ACTIONS/HOVER_ONLY children reveal on hover. */
export const HOVER_PARENT = "bins-hoverable";

/**
 * Controls that fade in when their HOVER_PARENT is hovered — and are simply
 * always there on a touch device, which has no hover to discover them with.
 * For rows and headers with room to spare for a permanent icon.
 */
export const HOVER_ACTIONS = "bins-hover-actions";

/**
 * Like HOVER_ACTIONS, but GONE on touch rather than always-on. For controls
 * that overlay their content — a box cell in a shelf grid is ~58px wide, and
 * a permanent icon cluster would cover the box's name on every phone. Touch
 * reaches the same edits by tapping through to the box itself, so these are
 * strictly a pointer-device shortcut.
 */
export const HOVER_ONLY = "bins-hover-only";

/**
 * The app's only stylesheet, injected by root.tsx next to the early
 * color-scheme rules. Everything else is Mantine props or inline styles;
 * these rules are here because a `:hover` on a PARENT and an `:empty`
 * sibling cannot be written inline.
 *
 * Reveal is opacity, never display: the icons occupy their space at all
 * times, so nothing reflows under the pointer on the way to a click.
 */
export const UI_CSS = `
.${HOVER_ACTIONS}, .${HOVER_ONLY} { transition: opacity 120ms ease; }
.${HOVER_ONLY} { display: none; }
@media ${DESKTOP_MEDIA} {
  .${HOVER_ONLY} { display: flex; }
  .${HOVER_PARENT} .${HOVER_ACTIONS},
  .${HOVER_PARENT} .${HOVER_ONLY} { opacity: 0; }
  .${HOVER_PARENT}:hover .${HOVER_ACTIONS},
  .${HOVER_PARENT}:focus-within .${HOVER_ACTIONS},
  .${HOVER_PARENT}:hover .${HOVER_ONLY},
  .${HOVER_PARENT}:focus-within .${HOVER_ONLY} { opacity: 1; }
}
/* A card whose component rendered nothing must not leave its gap behind. */
.bins-card-grid > div:empty { display: none; }
`;
