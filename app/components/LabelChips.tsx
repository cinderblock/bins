/**
 * Multi-select category-label picker: the group's active labels as toggleable
 * colored chips, plus an inline "new label" field that creates one (auto-
 * colored) and selects it. Presentational over a `selected` set — the caller
 * decides what a toggle means (local claim state vs. an immediate bin.setLabel).
 */
import { Chip, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { upsertLabel } from "~/lib/actions";
import { db } from "~/lib/db";
import { labelColor, nextLabelColor } from "~/lib/labels";

export function LabelChips({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  /** Called with the label id and whether it should now be present. */
  onToggle: (labelId: string, present: boolean) => void;
}) {
  const labels = useLiveQuery(
    () =>
      db.labels
        .orderBy("sortOrder")
        .filter((l) => !l.archived)
        .toArray(),
    [],
    [],
  );
  const [draft, setDraft] = useState("");

  async function create() {
    const name = draft.trim();
    if (!name) return;
    // Reuse an existing (case-insensitive) label instead of duplicating it.
    const existing = labels.find(
      (l) => l.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      onToggle(existing.id, true);
      setDraft("");
      return;
    }
    const id = crypto.randomUUID();
    const sortOrder = (labels.at(-1)?.sortOrder ?? 0) + 1;
    await upsertLabel(id, name, nextLabelColor(labels.length), sortOrder);
    onToggle(id, true);
    setDraft("");
  }

  return (
    <Stack gap="xs">
      {labels.length > 0 && (
        <Group gap="xs">
          {labels.map((label) => (
            <Chip
              key={label.id}
              color={labelColor(label.color)}
              checked={selected.has(label.id)}
              onChange={(checked) => onToggle(label.id, checked)}
            >
              {label.name}
            </Chip>
          ))}
        </Group>
      )}
      <TextInput
        placeholder="new category…"
        leftSection={<IconPlus size={16} />}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void create();
          }
        }}
      />
      {labels.length === 0 && (
        <Text size="xs" c="dimmed">
          No categories yet — type one above (e.g. booze, kitchen, shade).
        </Text>
      )}
    </Stack>
  );
}
