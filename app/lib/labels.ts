/**
 * Category-label palette + weight helpers, shared by every label/weight UI.
 *
 * Labels store an optional Mantine color name; new labels are auto-assigned the
 * next palette color so a fresh group gets visually distinct chips for free.
 * Weight is stored canonically in GRAMS (see shared/ops.ts); the display unit
 * (lb/kg) is a per-device preference — no group-wide unit exists.
 */

/** Distinct, dark-theme-friendly Mantine colors, cycled for new labels. */
export const LABEL_COLORS = [
  "grape",
  "red",
  "orange",
  "yellow",
  "lime",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "pink",
] as const;

/** Chip color for a label, falling back to gray when none was chosen. */
export function labelColor(color: string | null | undefined): string {
  return color ?? "gray";
}

/** The palette color to assign the Nth label created in a group. */
export function nextLabelColor(existingCount: number): string {
  return LABEL_COLORS[existingCount % LABEL_COLORS.length] as string;
}

export type WeightUnit = "lb" | "kg";
const WEIGHT_UNIT_KEY = "bins.weightUnit";
const GRAMS_PER_LB = 453.59237;
const GRAMS_PER_KG = 1000;

/** Per-device display unit; defaults to pounds. Safe on the server (no window). */
export function getWeightUnit(): WeightUnit {
  if (typeof localStorage === "undefined") return "lb";
  return localStorage.getItem(WEIGHT_UNIT_KEY) === "kg" ? "kg" : "lb";
}

export function setWeightUnit(unit: WeightUnit): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(WEIGHT_UNIT_KEY, unit);
  }
}

const gramsPer = (unit: WeightUnit) =>
  unit === "kg" ? GRAMS_PER_KG : GRAMS_PER_LB;

/** A value in the given unit → integer grams (the canonical stored form). */
export function toGrams(value: number, unit: WeightUnit): number {
  return Math.round(value * gramsPer(unit));
}

/** Grams → a value in the given unit, rounded to one decimal for editing. */
export function fromGrams(grams: number, unit: WeightUnit): number {
  return Math.round((grams / gramsPer(unit)) * 10) / 10;
}

/** Grams → a short human string in the preferred unit, e.g. "12.3 lb". */
export function formatWeight(
  grams: number,
  unit: WeightUnit = getWeightUnit(),
): string {
  const value = fromGrams(grams, unit);
  return `${value} ${unit}`;
}
