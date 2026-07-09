/**
 * "Where is this box" bottom sheet: one tap on a group-configured place, or a
 * freeform entry at the bottom ("somewhere else…"). Places are managed in
 * Settings; bins store the location as plain text so freeform costs nothing.
 */
import { Button, Group, Stack, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { setBinLocation } from "~/lib/actions";
import { db } from "~/lib/db";

export function LocationSheet({
  binId,
  current,
  opened,
  onClose,
}: {
  binId: number;
  current: string | null;
  opened: boolean;
  onClose: () => void;
}) {
  const [freeform, setFreeform] = useState("");
  const places = useLiveQuery(
    () =>
      db.locations
        .orderBy("sortOrder")
        .filter((l) => !l.archived)
        .toArray(),
    [],
    [],
  );

  async function pick(name: string | null) {
    await setBinLocation(binId, name);
    notifications.show({
      message: name ? `Location: ${name}` : "Location cleared",
      color: "green",
    });
    setFreeform("");
    onClose();
  }

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title="Where is this box?"
    >
      <Stack gap="xs" pb="env(safe-area-inset-bottom)">
        {places.map((place) => (
          <Button
            key={place.id}
            size="lg"
            variant={place.name === current ? "filled" : "light"}
            onClick={() => void pick(place.name)}
          >
            {place.name}
          </Button>
        ))}
        <Group gap="xs" mt="xs">
          <TextInput
            placeholder="somewhere else…"
            value={freeform}
            onChange={(e) => setFreeform(e.currentTarget.value)}
            size="lg"
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeform.trim())
                void pick(freeform.trim());
            }}
          />
          <Button
            size="lg"
            variant="default"
            disabled={!freeform.trim()}
            onClick={() => void pick(freeform.trim())}
          >
            Set
          </Button>
        </Group>
        {current && (
          <Button
            size="sm"
            variant="subtle"
            color="gray"
            onClick={() => void pick(null)}
          >
            Clear location
          </Button>
        )}
      </Stack>
    </ResponsiveSheet>
  );
}
