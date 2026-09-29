/**
 * Lengths on a floor plan. Stored as millimetres (shared/ops.ts); shown in
 * feet-and-inches or metres by per-device preference, the way weight is
 * (lib/labels.ts). No group-wide unit: two people measuring the same room
 * in different units is normal, and neither should see the other's.
 *
 * The first time, the length unit follows the weight unit — someone who
 * weighs boxes in pounds measures rooms in feet.
 */
import { getWeightUnit } from "./labels";

export type LengthUnit = "ft" | "m";
const LENGTH_UNIT_KEY = "bins.lengthUnit";
const MM_PER_INCH = 25.4;
const MM_PER_FOOT = 304.8;

export function getLengthUnit(): LengthUnit {
  if (typeof localStorage === "undefined") return "ft";
  const stored = localStorage.getItem(LENGTH_UNIT_KEY);
  if (stored === "ft" || stored === "m") return stored;
  return getWeightUnit() === "kg" ? "m" : "ft";
}

export function setLengthUnit(unit: LengthUnit): void {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(LENGTH_UNIT_KEY, unit);
}

/**
 * "12′ 6″", "4″", "3.75 m", "45 cm". Inches round to the nearest half —
 * nobody lays out shelving to the sixteenth, and a drag lands wherever the
 * pointer let go.
 */
export function formatLength(mm: number, unit: LengthUnit): string {
  const sign = mm < 0 ? "−" : "";
  const abs = Math.abs(mm);
  if (unit === "m") {
    if (abs < 1000) return `${sign}${Math.round(abs / 10)} cm`;
    return `${sign}${(Math.round(abs / 10) / 100).toString()} m`;
  }
  const halfInches = Math.round(abs / (MM_PER_INCH / 2));
  let feet = Math.floor(halfInches / 24);
  let inches = (halfInches - feet * 24) / 2;
  if (inches >= 12) {
    feet += 1;
    inches -= 12;
  }
  if (feet === 0) return `${sign}${inches}″`;
  if (inches === 0) return `${sign}${feet}′`;
  return `${sign}${feet}′ ${inches}″`;
}

/**
 * Whatever a person types into a length box, in millimetres; null when it
 * can't be read. A bare number means the preferred unit's main measure
 * (feet or metres). Understood: `12' 6"`, `12ft 6in`, `12′6″`, `150 cm`,
 * `3.2m`, `900mm`, `18in`, `4.5`, and a leading minus.
 */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const raw = text.trim().toLowerCase().replace(/−/g, "-");
  if (!raw) return null;
  const negative = raw.startsWith("-");
  const s = negative ? raw.slice(1).trim() : raw;
  const num = "(\\d+(?:\\.\\d+)?|\\.\\d+)";

  const metric = new RegExp(`^${num}\\s*(mm|cm|m)$`).exec(s);
  if (metric) {
    const value = Number(metric[1]);
    const scale = metric[2] === "mm" ? 1 : metric[2] === "cm" ? 10 : 1000;
    return sign(value * scale, negative);
  }

  const imperial = new RegExp(
    `^(?:${num}\\s*(?:'|′|ft|feet|foot))?\\s*(?:${num}\\s*(?:"|″|in|inch|inches))?$`,
  ).exec(s);
  if (imperial && (imperial[1] || imperial[2])) {
    const feet = Number(imperial[1] ?? 0);
    const inches = Number(imperial[2] ?? 0);
    return sign(feet * MM_PER_FOOT + inches * MM_PER_INCH, negative);
  }

  const bare = new RegExp(`^${num}$`).exec(s);
  if (bare) {
    const value = Number(bare[1]);
    return sign(value * (unit === "m" ? 1000 : MM_PER_FOOT), negative);
  }
  return null;
}

function sign(mm: number, negative: boolean): number {
  return negative ? -mm : mm;
}

/**
 * The snap step for dragging: 6″ or 10 cm on a scaled plan; on an unscaled
 * one, half a grid square. Squares are 500 mm underneath — a size that
 * turns into sensible real lengths if the plan is later measured.
 */
export const GRID_SQUARE_MM = 500;

export function snapStep(scaled: boolean, unit: LengthUnit): number {
  if (!scaled) return GRID_SQUARE_MM / 2;
  return unit === "ft" ? 6 * MM_PER_INCH : 100;
}

/** Spacing of the drawn grid lines: 1′ / 50 cm, or one square. */
export function gridLineStep(scaled: boolean, unit: LengthUnit): number {
  if (!scaled) return GRID_SQUARE_MM;
  return unit === "ft" ? MM_PER_FOOT : 500;
}
