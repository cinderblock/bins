/**
 * An admin's everyday edit of a box, from wherever the box is being looked
 * at — the box list, the shelf wall. Everything here applies immediately;
 * the members' suggest-instead path lives in `EditBoxSheet` on the box page.
 *
 * Location is a BUTTON into the real picker rather than a text field. It used
 * to be a freeform `TextInput` bound to `locationName`, which for a box on a
 * shelf ("D3 · slot 5") showed empty and, the moment anyone typed in it,
 * wrote a freeform name over the shelf and the slot both. The picker walks
 * places → shelves → slots and still takes a freeform answer for the genuine
 * one-off ("Sam's truck").
 */
import { Button, Group, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { BinState } from "@shared/reducer";
import { IconMapPin } from "@tabler/icons-react";
import { useState } from "react";
import { FillLevelInput } from "~/components/FillLevel";
import { LabelChips } from "~/components/LabelChips";
import { LocationSheet } from "~/components/LocationSheet";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { WeightInput } from "~/components/WeightInput";
import { setBinFields, setBinLabel } from "~/lib/actions";
import { boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import { describeBinLocationLong, usePlaceMap } from "~/lib/places";

export function BoxQuickEdit({
  bin,
  onClose,
}: {
  bin: BinState;
  onClose: () => void;
}) {
  const numbersInternal = useBoxNumbersInternal();
  const placeById = usePlaceMap();
  const [name, setName] = useState(bin.name ?? "");
  const [description, setDescription] = useState(bin.description ?? "");
  const [weightGrams, setWeightGrams] = useState<number | null>(
    bin.weightGrams,
  );
  const [fillLevel, setFillLevel] = useState<number | null>(bin.fillLevel);
  const [busy, setBusy] = useState(false);
  // The two sheets never nest — the picker hides this one instead. The draft
  // above survives because it lives here, not inside the modal Mantine
  // unmounts when it closes.
  const [moving, setMoving] = useState(false);

  const where = describeBinLocationLong(bin, placeById);

  async function save() {
    setBusy(true);
    try {
      await setBinFields(bin.id, {
        name: name.trim() || null,
        description: description.trim() || null,
        weightGrams,
        fillLevel,
      });
      notifications.show({ message: "Saved", color: "green" });
      onClose();
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ResponsiveSheet
        opened={!moving}
        onClose={onClose}
        title={`Edit ${boxTitle(bin, numbersInternal)}`}
        dismissLabel="Cancel"
      >
        <Stack gap="sm" pb="env(safe-area-inset-bottom)">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Textarea
            label="Subtext"
            description="A few short lines under the title — printed on the label."
            autosize
            minRows={2}
            maxRows={4}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Where it is
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text
                size="sm"
                c={where ? undefined : "dimmed"}
                style={{ flex: 1 }}
              >
                {where ?? "Nowhere recorded"}
              </Text>
              <Button
                variant="default"
                size="compact-sm"
                leftSection={<IconMapPin size={14} />}
                onClick={() => setMoving(true)}
              >
                Move
              </Button>
            </Group>
          </div>
          <FillLevelInput value={fillLevel} onChange={setFillLevel} />
          <WeightInput grams={weightGrams} onChange={setWeightGrams} />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Categories
            </Text>
            {/* Membership applies immediately (the bin already exists). */}
            <LabelChips
              selected={new Set(bin.labelIds)}
              onToggle={(labelId, present) =>
                void setBinLabel(bin.id, labelId, present)
              }
            />
          </div>
          <Button onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </Stack>
      </ResponsiveSheet>
      <LocationSheet
        bin={bin}
        opened={moving}
        onClose={() => setMoving(false)}
      />
    </>
  );
}
