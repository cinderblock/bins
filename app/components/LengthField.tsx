/**
 * A length on a floor plan, typed. On a scaled plan it reads and writes real
 * lengths in the device's unit ("12′ 6″", "3.2 m" — lib/lengths.ts parses
 * anything reasonable). On an unscaled plan there is nothing to measure, so
 * it counts grid squares instead.
 *
 * Commits on blur or Enter, never per keystroke: every commit is an op.
 */
import { TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import {
  GRID_SQUARE_MM,
  type LengthUnit,
  formatLength,
  parseLength,
} from "~/lib/lengths";

function show(mm: number, scaled: boolean, unit: LengthUnit): string {
  if (scaled) return formatLength(mm, unit);
  return String(Math.round((mm / GRID_SQUARE_MM) * 100) / 100);
}

function read(text: string, scaled: boolean, unit: LengthUnit): number | null {
  if (scaled) return parseLength(text, unit);
  const n = Number(text.trim());
  return Number.isFinite(n) && text.trim() ? n * GRID_SQUARE_MM : null;
}

export function LengthField({
  label,
  value,
  onCommit,
  scaled,
  unit,
  min,
}: {
  label: string;
  value: number;
  onCommit: (mm: number) => void;
  scaled: boolean;
  unit: LengthUnit;
  /** Lengths refuse zero and below; positions don't pass this. */
  min?: number;
}) {
  const [text, setText] = useState(() => show(value, scaled, unit));
  const [error, setError] = useState<string | null>(null);
  // Follow the value when something else moves it (a drag, an undo).
  useEffect(() => {
    setText(show(value, scaled, unit));
    setError(null);
  }, [value, scaled, unit]);

  function commit() {
    const mm = read(text, scaled, unit);
    if (mm === null || (min !== undefined && mm < min)) {
      setError(scaled ? "e.g. 4′ 6″ or 1.4 m" : "a number of squares");
      return;
    }
    setError(null);
    if (Math.abs(mm - value) > 0.05) onCommit(mm);
    else setText(show(value, scaled, unit));
  }

  return (
    <TextInput
      size="xs"
      label={label}
      value={text}
      error={error}
      rightSection={scaled ? undefined : "sq"}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setText(show(value, scaled, unit));
      }}
    />
  );
}
