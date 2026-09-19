/**
 * Bin-page bottom sheet for categorizing a box: toggle its category labels
 * (applied instantly — a box is many-to-many with labels), set its weight and
 * how full it is. Labels write straight through as bin.setLabel ops; weight
 * and fill level are buffered while editing (an op per keystroke would be
 * absurd) and flushed together when the sheet closes, by whichever route — a
 * "Save" the user has to find is a trap when everything else on the sheet
 * already applied itself.
 */
import { Divider, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { BinFields } from "@shared/ops";
import { useEffect, useState } from "react";
import { FillLevelInput } from "~/components/FillLevel";
import { LabelChips } from "~/components/LabelChips";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { WeightInput } from "~/components/WeightInput";
import { setBinFields, setBinLabel } from "~/lib/actions";

export function LabelSheet({
  binId,
  labelIds,
  weightGrams,
  fillLevel,
  opened,
  onClose,
}: {
  binId: number;
  labelIds: string[];
  weightGrams: number | null;
  fillLevel: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const [weight, setWeight] = useState<number | null>(weightGrams);
  const [fill, setFill] = useState<number | null>(fillLevel);
  // The drawer stays mounted (only visibility toggles), so re-seed the
  // buffers from the live values each time it opens — avoids showing a stale
  // number if something changed elsewhere since first render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed only on open
  useEffect(() => {
    if (opened) {
      setWeight(weightGrams);
      setFill(fillLevel);
    }
  }, [opened]);

  async function close() {
    // One op for whatever changed — each field is its own LWW clock, so an
    // untouched field stays out of the payload and can't clobber a newer
    // write from another device.
    const changed: BinFields = {};
    if (weight !== weightGrams) changed.weightGrams = weight;
    if (fill !== fillLevel) changed.fillLevel = fill;
    if (Object.keys(changed).length > 0) {
      await setBinFields(binId, changed);
      notifications.show({ message: "Saved", color: "green" });
    }
    onClose();
  }

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={() => void close()}
      title="Categories, weight & fill"
      dismissLabel="Done"
    >
      <Stack gap="md">
        <div>
          <Text size="sm" fw={500} mb={6}>
            Categories
          </Text>
          <LabelChips
            selected={new Set(labelIds)}
            onToggle={(labelId, present) =>
              void setBinLabel(binId, labelId, present)
            }
          />
        </div>
        <Divider />
        <FillLevelInput value={fill} onChange={setFill} />
        <WeightInput grams={weight} onChange={setWeight} />
      </Stack>
    </ResponsiveSheet>
  );
}
