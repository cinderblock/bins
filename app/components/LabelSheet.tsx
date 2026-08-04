/**
 * Bin-page bottom sheet for categorizing a box: toggle its category labels
 * (applied instantly — a box is many-to-many with labels) and set its weight.
 * Labels write straight through as bin.setLabel ops; weight is buffered while
 * typing (an op per keystroke would be absurd) and flushed when the sheet
 * closes, by whichever route — a "Save" the user has to find is a trap when
 * everything else on the sheet already applied itself.
 */
import { Divider, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useState } from "react";
import { LabelChips } from "~/components/LabelChips";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { WeightInput } from "~/components/WeightInput";
import { setBinFields, setBinLabel } from "~/lib/actions";

export function LabelSheet({
  binId,
  labelIds,
  weightGrams,
  opened,
  onClose,
}: {
  binId: number;
  labelIds: string[];
  weightGrams: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const [weight, setWeight] = useState<number | null>(weightGrams);
  // The drawer stays mounted (only visibility toggles), so re-seed the weight
  // buffer from the live value each time it opens — avoids showing a stale
  // number if the weight changed elsewhere since first render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed only on open
  useEffect(() => {
    if (opened) setWeight(weightGrams);
  }, [opened]);

  async function close() {
    if (weight !== weightGrams) {
      await setBinFields(binId, { weightGrams: weight });
      notifications.show({
        message: weight == null ? "Weight cleared" : "Weight saved",
        color: "green",
      });
    }
    onClose();
  }

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={() => void close()}
      title="Categories & weight"
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
        <WeightInput grams={weight} onChange={setWeight} />
      </Stack>
    </ResponsiveSheet>
  );
}
