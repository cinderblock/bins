/**
 * Weight field: a number + a lb/kg toggle, but the value in/out is always
 * GRAMS (the canonical stored unit). The unit is a per-device preference,
 * remembered across boxes so a US crew types pounds every time without fuss.
 */
import { Group, NumberInput, SegmentedControl } from "@mantine/core";
import { useState } from "react";
import {
  type WeightUnit,
  fromGrams,
  getWeightUnit,
  setWeightUnit,
  toGrams,
} from "~/lib/labels";

export function WeightInput({
  grams,
  onChange,
  label = "Weight",
}: {
  grams: number | null;
  /** Emits integer grams, or null when the field is cleared. */
  onChange: (grams: number | null) => void;
  label?: string;
}) {
  const [unit, setUnit] = useState<WeightUnit>(getWeightUnit());
  const value = grams == null ? "" : fromGrams(grams, unit);

  function changeUnit(next: WeightUnit) {
    setUnit(next);
    setWeightUnit(next);
  }

  return (
    <NumberInput
      label={label}
      placeholder="optional"
      min={0}
      step={unit === "kg" ? 0.5 : 1}
      value={value}
      onChange={(v) =>
        onChange(v === "" || v == null ? null : toGrams(Number(v), unit))
      }
      rightSectionWidth={92}
      rightSection={
        <SegmentedControl
          size="xs"
          value={unit}
          onChange={(v) => changeUnit(v as WeightUnit)}
          data={[
            { label: "lb", value: "lb" },
            { label: "kg", value: "kg" },
          ]}
        />
      }
    />
  );
}
