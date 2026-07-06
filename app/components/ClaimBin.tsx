/**
 * Inline claim panel — scanning a fresh (unclaimed) sticker lands on the bin
 * URL and this renders in place; on claim the same route re-renders as a
 * normal bin. Works offline: unclaimed bins are already in the replica.
 */
import {
  Button,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { claimBin } from "~/lib/actions";

const SIZE_CLASSES = ["S", "M", "L", "XL"];

export function ClaimBin({ binId }: { binId: number }) {
  const [name, setName] = useState("");
  const [sizeClass, setSizeClass] = useState("M");
  const [externalLabel, setExternalLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function claim() {
    setBusy(true);
    await claimBin(binId, {
      name: name.trim() || null,
      sizeClass,
      externalLabel: externalLabel.trim() || null,
    });
    notifications.show({ message: `Bin #${binId} claimed`, color: "green" });
    setBusy(false);
  }

  return (
    <Paper p="lg" radius="lg" withBorder m="md">
      <Stack>
        <Title order={3}>New box #{binId}</Title>
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
        <div>
          <Text size="sm" fw={500} mb={4}>
            Size
          </Text>
          <SegmentedControl
            fullWidth
            size="lg"
            data={SIZE_CLASSES}
            value={sizeClass}
            onChange={setSizeClass}
          />
        </div>
        <TextInput
          label="External labels"
          placeholder="what's written on the outside, e.g. K1 / red tape"
          size="lg"
          value={externalLabel}
          onChange={(e) => setExternalLabel(e.currentTarget.value)}
        />
        <Button size="lg" onClick={() => void claim()} loading={busy}>
          Claim bin
        </Button>
      </Stack>
    </Paper>
  );
}
