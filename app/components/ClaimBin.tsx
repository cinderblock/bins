/**
 * Inline claim panel — scanning a fresh (unclaimed) sticker lands on the bin
 * URL and this renders in place; on claim the same route re-renders as a
 * normal bin. Works offline: unclaimed bins are already in the replica.
 */
import { Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { FillLevelInput } from "~/components/FillLevel";
import { LabelChips } from "~/components/LabelChips";
import { SizePicker } from "~/components/SizePicker";
import { WeightInput } from "~/components/WeightInput";
import { claimBin, setBinLabel } from "~/lib/actions";
import { useBoxNumbersInternal } from "~/lib/boxRef";
import { useBoxSizes } from "~/lib/boxSizes";

export function ClaimBin({ binId }: { binId: number }) {
  const [name, setName] = useState("");
  const sizes = useBoxSizes();
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [weightGrams, setWeightGrams] = useState<number | null>(null);
  const [fillLevel, setFillLevel] = useState<number | null>(null);
  const [labels, setLabels] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const numbersInternal = useBoxNumbersInternal();

  function toggleLabel(labelId: string, present: boolean) {
    setLabels((prev) => {
      const next = new Set(prev);
      if (present) next.add(labelId);
      else next.delete(labelId);
      return next;
    });
  }

  async function claim() {
    setBusy(true);
    await claimBin(binId, {
      name: name.trim() || null,
      sizeId,
      weightGrams,
      fillLevel,
    });
    // Membership is its own op stream — enqueue one per chosen category.
    for (const labelId of labels) await setBinLabel(binId, labelId, true);
    notifications.show({
      message: numbersInternal ? "Box set up" : `Bin #${binId} claimed`,
      color: "green",
    });
    setBusy(false);
  }

  return (
    <Paper p="lg" radius="lg" withBorder m="md">
      <Stack>
        <Title order={3}>
          {numbersInternal ? "New box" : `New box #${binId}`}
        </Title>
        <Text c="dimmed" size="sm">
          Fresh sticker — set up this bin.
        </Text>
        <TextInput
          label="Name"
          placeholder="e.g. Kitchen gear"
          size="lg"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          autoFocus
        />
        <SizePicker sizes={sizes} value={sizeId} onChange={setSizeId} />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Categories
          </Text>
          <LabelChips selected={labels} onToggle={toggleLabel} />
        </div>
        <FillLevelInput value={fillLevel} onChange={setFillLevel} />
        <WeightInput grams={weightGrams} onChange={setWeightGrams} />
        <Button size="lg" onClick={() => void claim()} loading={busy}>
          Claim bin
        </Button>
      </Stack>
    </Paper>
  );
}
