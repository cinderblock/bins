/**
 * Reading box-size definitions on the client, and rendering their dimensions.
 *
 * Definitions are admin-authored and arrive by ordinary sync, so every device
 * just reads the local replica. Dimensions are canonical millimetres — the
 * same choice weight makes with grams — and are converted for display only.
 */
import type { BoxSizeState } from "@shared/reducer";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

/** Active definitions in the admin's chosen order. */
export function useBoxSizes(): BoxSizeState[] {
  return (
    useLiveQuery(
      async () =>
        (await db.boxSizes.toArray())
          .filter((s) => !s.archived)
          .sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
          ),
      [],
      [],
    ) ?? []
  );
}

const MM_PER_INCH = 25.4;

/** One dimension, rounded for display. */
function inches(mm: number): string {
  return `${Math.round((mm / MM_PER_INCH) * 10) / 10}`;
}

/**
 * "38 × 30 × 25 cm" / "15 × 11.8 × 9.8 in", or null when a size carries no
 * dimensions — which is legitimate and common.
 */
export function formatDimensions(
  size: Pick<BoxSizeState, "lengthMm" | "widthMm" | "heightMm">,
  unit: "cm" | "in" = "in",
): string | null {
  const parts = [size.lengthMm, size.widthMm, size.heightMm];
  if (parts.every((p) => p == null)) return null;
  const shown = parts.map((p) =>
    p == null ? "?" : unit === "cm" ? `${Math.round(p / 10)}` : inches(p),
  );
  return `${shown.join(" × ")} ${unit}`;
}

/** Name plus dimensions when it has them — what a picker option should read. */
export function describeSize(
  size: BoxSizeState,
  unit: "cm" | "in" = "in",
): string {
  const dims = formatDimensions(size, unit);
  return dims ? `${size.name} (${dims})` : size.name;
}
