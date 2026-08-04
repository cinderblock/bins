/**
 * Multi-select category-label picker: the group's active labels as toggleable
 * colored chips, plus a way to create one (auto-colored) and select it.
 * Presentational over a `selected` set — the caller decides what a toggle means
 * (local claim state vs. an immediate bin.setLabel).
 *
 * Two layouts. On a mouse+hover desktop it stays the compact chip row over an
 * always-open "new category…" field, where the leading + reads as an adornment
 * and Enter submits. On touch that field was a trap: the + looked like a button
 * but wasn't, and Enter is buried on a soft keyboard — so touch instead gets a
 * real "+ New" chip that opens a composer with an explicit Add button, and
 * finger-sized chips throughout.
 */
import {
  ActionIcon,
  Button,
  Chip,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { upsertLabel } from "~/lib/actions";
import { db } from "~/lib/db";
import { labelColor, nextLabelColor } from "~/lib/labels";
import { TOUCH_MEDIA, TOUCH_TARGET } from "~/lib/ui";

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
  const touch =
    useMediaQuery(TOUCH_MEDIA, false, { getInitialValueInEffect: false }) ??
    false;
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);

  /** Create (or re-select) the drafted category. Returns false if empty. */
  async function create() {
    const name = draft.trim();
    if (!name) return false;
    // Reuse an existing (case-insensitive) label instead of duplicating it.
    const existing = labels.find(
      (l) => l.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      onToggle(existing.id, true);
      setDraft("");
      return true;
    }
    const id = crypto.randomUUID();
    const sortOrder = (labels.at(-1)?.sortOrder ?? 0) + 1;
    await upsertLabel(id, name, nextLabelColor(labels.length), sortOrder);
    onToggle(id, true);
    setDraft("");
    return true;
  }

  const chips = labels.map((label) => (
    <Chip
      key={label.id}
      color={labelColor(label.color)}
      size={touch ? "lg" : "sm"}
      checked={selected.has(label.id)}
      onChange={(checked) => onToggle(label.id, checked)}
      styles={
        touch
          ? { label: { height: TOUCH_TARGET, paddingInline: 18, fontSize: 16 } }
          : undefined
      }
    >
      {label.name}
    </Chip>
  ));

  if (!touch) {
    return (
      <Stack gap="xs">
        {labels.length > 0 && <Group gap="xs">{chips}</Group>}
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

  // Touch: the composer replaces the "+ New" chip so the row never reflows out
  // from under a thumb, and closes on add so the keyboard drops and the new
  // chip is actually visible.
  return (
    <Stack gap="xs">
      <Group gap="xs">
        {chips}
        {!composing && (
          <Button
            variant="default"
            radius="xl"
            leftSection={<IconPlus size={18} />}
            h={TOUCH_TARGET}
            onClick={() => setComposing(true)}
          >
            New
          </Button>
        )}
      </Group>
      {composing && (
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <TextInput
            style={{ flex: 1 }}
            size="md"
            placeholder="e.g. booze"
            aria-label="New category name"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="done"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void create().then((ok) => ok && setComposing(false));
            }}
          />
          <Button
            size="md"
            disabled={!draft.trim()}
            onClick={() =>
              void create().then((ok) => ok && setComposing(false))
            }
          >
            Add
          </Button>
          <ActionIcon
            size={42}
            variant="subtle"
            color="gray"
            aria-label="Cancel new category"
            onClick={() => {
              setDraft("");
              setComposing(false);
            }}
          >
            <IconX size={20} />
          </ActionIcon>
        </Group>
      )}
      {labels.length === 0 && !composing && (
        <Text size="xs" c="dimmed">
          No categories yet — tap “New” to make one (e.g. booze, kitchen,
          shade).
        </Text>
      )}
    </Stack>
  );
}
