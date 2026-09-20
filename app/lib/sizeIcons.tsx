/**
 * The built-in size icon set. A size definition (boxSize.upsert) names one
 * of these by key; the picker, badges and the shelf wall draw it so a size
 * reads at a glance without reading. Drawn as simple line icons on a 24-unit
 * grid, roughly in proportion to each other so the set itself suggests
 * relative size.
 *
 * Keys are protocol data (they sync), so they are stable identifiers: rename
 * a label freely, never a key. An unknown key draws the generic box, which
 * is what lets the set grow without a migration.
 */
import type { ReactNode } from "react";

export type SizeIconKey =
  | "box"
  | "pencil-case"
  | "paper-stack"
  | "bankers-box"
  | "tote"
  | "crate"
  | "envelope"
  | "tube"
  | "bag"
  | "drawer";

export const SIZE_ICONS: { key: SizeIconKey; label: string }[] = [
  { key: "pencil-case", label: "Pencil case" },
  { key: "paper-stack", label: "Paper stack" },
  { key: "bankers-box", label: "Banker's box" },
  { key: "box", label: "Box" },
  { key: "tote", label: "Tote" },
  { key: "crate", label: "Crate" },
  { key: "envelope", label: "Envelope" },
  { key: "tube", label: "Tube" },
  { key: "bag", label: "Bag" },
  { key: "drawer", label: "Drawer" },
];

const PATHS: Record<SizeIconKey, ReactNode> = {
  // A small zipped pouch.
  "pencil-case": (
    <>
      <rect x="4" y="9" width="16" height="7" rx="3" />
      <path d="M6 9 L8 7 h8 l2 2" />
      <path d="M8 7 v-1 M16 7 v-1" />
    </>
  ),
  // Reams stacked, offset a touch so the stack reads as more than one.
  "paper-stack": (
    <>
      <path d="M5 8 h12 l2 2 v3 H7 l-2 -2 z" />
      <path d="M5 12 h12 l2 2 v3 H7 l-2 -2 z" />
      <path d="M17 8 v3 M17 12 v3" />
    </>
  ),
  // The classic lidded box with hand-holes.
  "bankers-box": (
    <>
      <rect x="3" y="7" width="18" height="12" rx="1" />
      <path d="M2 7 h20 v2 H2 z" />
      <path d="M9 13 h6" />
    </>
  ),
  box: (
    <>
      <path d="M12 3 L20 7 v10 l-8 4 -8 -4 V7 z" />
      <path d="M12 3 v18 M4 7 l8 4 8 -4" />
    </>
  ),
  tote: (
    <>
      <path d="M4 9 h16 l-1.5 10 h-13 z" />
      <path d="M8 9 V7 a4 4 0 0 1 8 0 v2" />
    </>
  ),
  crate: (
    <>
      <rect x="3" y="6" width="18" height="12" />
      <path d="M3 10 h18 M3 14 h18 M8 6 v12 M16 6 v12" />
    </>
  ),
  envelope: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="1" />
      <path d="M3 8 l9 6 9 -6" />
    </>
  ),
  tube: (
    <>
      <path d="M5 6 h14 v12 H5 z" />
      <ellipse cx="12" cy="6" rx="7" ry="2" />
      <path d="M5 18 a7 2 0 0 0 14 0" />
    </>
  ),
  bag: (
    <>
      <path d="M6 9 h12 l1 11 H5 z" />
      <path d="M9 9 V6 a3 3 0 0 1 6 0 v3" />
    </>
  ),
  drawer: (
    <>
      <rect x="3" y="8" width="18" height="9" rx="1" />
      <path d="M10 12.5 h4" />
      <path d="M3 17 v2 M21 17 v2" />
    </>
  ),
};

export function isSizeIconKey(
  key: string | null | undefined,
): key is SizeIconKey {
  return !!key && Object.hasOwn(PATHS, key);
}

/** A size's icon; unknown or missing keys draw the generic box. */
export function SizeIcon({
  icon,
  size = 20,
  ...rest
}: {
  icon: string | null | undefined;
  size?: number;
  style?: React.CSSProperties;
}) {
  const key: SizeIconKey = isSizeIconKey(icon) ? icon : "box";
  const label = SIZE_ICONS.find((o) => o.key === key)?.label ?? "Box";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      focusable="false"
      {...rest}
    >
      <title>{label}</title>
      {PATHS[key]}
    </svg>
  );
}
