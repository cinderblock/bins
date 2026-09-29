/**
 * "Lay these walls out on a floor plan" — the one step between a site that
 * has several separate walls and a site that has a map.
 *
 * Makes a new top-level place (the room), gives it an empty floor plan, and
 * moves the chosen walls inside it. Moving is an ordinary location.upsert
 * that states every existing field again — an upsert ASSIGNS, so leaving a
 * field out would wipe a shelf's grid or sticker.
 */
import {
  Button,
  Checkbox,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { LocationState } from "@shared/reducer";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { setPlacePlan, upsertLocation } from "~/lib/actions";

export function NewSpaceSheet({
  opened,
  onClose,
  candidates,
  nextSortOrder,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  /** Top-level walls that could go inside it; all ticked to start. */
  candidates: LocationState[];
  nextSortOrder: number;
  onCreated: (spaceId: string) => void;
}) {
  const [name, setName] = useState("");
  const [scaled, setScaled] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: seed on open
  useEffect(() => {
    if (!opened) return;
    setName("");
    setScaled(false);
    setChosen(new Set(candidates.map((c) => c.id)));
  }, [opened]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      await upsertLocation(id, trimmed, nextSortOrder, { parentId: null });
      await setPlacePlan(id, { scaled, outline: [], landmarks: [] });
      for (const wall of candidates) {
        if (!chosen.has(wall.id)) continue;
        await upsertLocation(wall.id, wall.name, wall.sortOrder, {
          parentId: id,
          cols: wall.cols,
          rows: wall.rows,
          span: wall.span,
          code: wall.code,
        });
      }
      notifications.show({
        message: `${trimmed} is ready — drag its walls into place`,
        color: "green",
      });
      onCreated(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title="Lay out a floor plan"
      dismissLabel="Cancel"
    >
      <Stack gap="sm" pb="env(safe-area-inset-bottom)">
        <Text size="sm" c="dimmed">
          A floor plan is a room seen from above, with its walls of shelves
          standing where they really are. Name the room, choose what's in it,
          and then arrange them on the map.
        </Text>
        <TextInput
          label="The room"
          placeholder="e.g. Warehouse, Garage, Unit 14"
          value={name}
          autoFocus
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        {candidates.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              What's in it
            </Text>
            {candidates.map((c) => (
              <Checkbox
                key={c.id}
                label={c.name}
                checked={chosen.has(c.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.currentTarget.checked) next.add(c.id);
                  else next.delete(c.id);
                  setChosen(next);
                }}
              />
            ))}
          </Stack>
        )}
        <Switch
          checked={scaled}
          onChange={(e) => setScaled(e.currentTarget.checked)}
          label="I'll draw it to measurements"
          description="Off: rough it in on a grid. Either can be changed later."
        />
        <Button
          loading={busy}
          disabled={!name.trim()}
          onClick={() => void create()}
        >
          Create and arrange
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}
