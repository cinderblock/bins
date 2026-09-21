/**
 * The one editor for a place — a room, a bay, a shelf with numbered slots.
 *
 * It used to be a form pinned to the top of the shelf builder's card, which
 * was fine when that card was the only thing on screen and awful everywhere
 * else: clicking Edit on the fortieth shelf scrolled the form out of sight,
 * and the shelf wall (where you actually notice that D3 is mislabelled) had
 * no way in at all. A sheet comes to whoever opened it, so the same editor
 * now serves the builder, the wall, and the Settings › Places card.
 *
 * Nothing about any particular site is in this file — "H4 is 3 wide by 2
 * tall" is op-driven data belonging to one deployment.
 */
import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { locationLabel, slotNames, wouldCycle } from "@shared/locations";
import type { LocationState } from "@shared/reducer";
import { IconArchive, IconArchiveOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { InlineCreate } from "~/components/InlineCreate";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { archiveLocation, upsertLocation } from "~/lib/actions";
import { createPlace, usePlaceMap } from "~/lib/places";

type Draft = {
  name: string;
  parentId: string | null;
  grid: boolean;
  cols: number;
  rows: number;
  span: number;
  /** What this shelf's own printed sticker says; "" = none. */
  code: string;
};

function draftOf(place: LocationState | null, parentId: string | null): Draft {
  return {
    name: place?.name ?? "",
    parentId: place ? place.parentId : parentId,
    grid: place != null && place.cols != null && place.rows != null,
    cols: place?.cols ?? 3,
    rows: place?.rows ?? 2,
    span: place?.span ?? 1,
    code: place?.code ?? "",
  };
}

export function PlaceEditSheet({
  /** The place being edited, or null to create a new one. */
  place,
  /** Where a NEW place lands — "add a shelf" from inside a bay knows this. */
  defaultParentId = null,
  opened,
  onClose,
}: {
  place: LocationState | null;
  defaultParentId?: string | null;
  opened: boolean;
  onClose: () => void;
}) {
  const byId = usePlaceMap();
  const [draft, setDraft] = useState<Draft>(() =>
    draftOf(place, defaultParentId),
  );
  const [busy, setBusy] = useState(false);

  // Re-seed each time it opens (and whenever it's pointed at another place):
  // the sheet outlives any one row, and stale values here write real ops.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed on open / target change
  useEffect(() => {
    if (!opened) return;
    setDraft(draftOf(place, defaultParentId));
  }, [opened, place?.id, defaultParentId]);

  // Two shelves answering to one sticker is ambiguous, and the reducer can't
  // refuse it without becoming order-dependent (shared/ops.ts), so this is
  // where a person finds out.
  const codeClash = (() => {
    const key = draft.code.trim().toLowerCase();
    if (!key) return null;
    const others = [...byId.values()].filter(
      (l) =>
        l.id !== place?.id &&
        !l.archived &&
        (l.code ?? "").trim().toLowerCase() === key,
    );
    return others.length > 0
      ? `${others.map((l) => l.name).join(", ")} already claims this sticker`
      : null;
  })();

  // A place can't be its own parent, and can't sit under its own descendant.
  const parentOptions = [...byId.values()]
    .filter((l) => !l.archived)
    .filter((l) => !place || !wouldCycle(byId, place.id, l.id))
    .map((l) => ({ value: l.id, label: locationLabel(byId, l.id) || l.name }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );

  const capacity = draft.grid ? draft.cols * draft.rows : null;

  async function save() {
    const name = draft.name.trim();
    if (!name) return;
    // Refuse a loop before writing. The walk helpers survive one either way,
    // but an editor that lets you create one is just handing you broken data.
    if (place && wouldCycle(byId, place.id, draft.parentId)) {
      notifications.show({
        message: "That would put a place inside itself",
        color: "red",
      });
      return;
    }
    setBusy(true);
    try {
      await upsertLocation(
        place?.id ?? crypto.randomUUID(),
        name,
        place?.sortOrder ?? byId.size,
        {
          parentId: draft.parentId,
          cols: draft.grid ? draft.cols : null,
          rows: draft.grid ? draft.rows : null,
          span: draft.span > 1 ? draft.span : null,
          code: draft.code,
        },
      );
      notifications.show({
        message: place ? `Saved ${name}` : `Added ${name}`,
        color: "green",
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title={place ? `Edit ${place.name}` : "New place"}
      dismissLabel="Cancel"
    >
      <Stack gap="xs" pb="env(safe-area-inset-bottom)">
        <TextInput
          label="Name"
          placeholder="e.g. H4"
          autoFocus={!place}
          value={draft.name}
          onChange={(e) =>
            setDraft((d) => ({ ...d, name: e.currentTarget.value }))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.name.trim()) void save();
          }}
        />
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Select
            label="Inside"
            placeholder="Nowhere in particular"
            data={parentOptions}
            value={draft.parentId}
            onChange={(v) => setDraft((d) => ({ ...d, parentId: v }))}
            clearable
            searchable
            style={{ flex: 1, minWidth: 0 }}
          />
          {/* Building a bay bottom-up: the aisle it belongs in often doesn't
              exist until you need to say so. */}
          <InlineCreate
            size="sm"
            label="New"
            placeholder="e.g. Aisle H"
            onCreate={async (name) => {
              const made = await createPlace(byId, name, null);
              setDraft((d) => ({ ...d, parentId: made.id }));
            }}
          />
        </Group>
        <Switch
          checked={draft.grid}
          onChange={(e) =>
            setDraft((d) => ({ ...d, grid: e.currentTarget.checked }))
          }
          label="This shelf holds boxes in numbered slots"
        />
        {draft.grid && (
          <>
            <Group grow>
              <NumberInput
                label="Across"
                min={1}
                max={64}
                value={draft.cols}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, cols: Number(v) || 1 }))
                }
              />
              <NumberInput
                label="Stacked"
                min={1}
                max={64}
                value={draft.rows}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, rows: Number(v) || 1 }))
                }
              />
            </Group>
            <Text size="xs" c="dimmed">
              {capacity} slots, numbered 1–{capacity} left to right, top to
              bottom.
            </Text>
            <SlotPreview cols={draft.cols} rows={draft.rows} />
          </>
        )}
        <NumberInput
          label="Height, in shelf units"
          description="Only affects how the shelf view draws it — a double-tall bottom shelf is 2."
          min={1}
          max={8}
          value={draft.span}
          onChange={(v) => setDraft((d) => ({ ...d, span: Number(v) || 1 }))}
        />
        {/* Normally learned by scanning: put-away offers to bind an unknown
            sticker to a shelf with the camera already on it. This is for
            fixing one up, or reading back what a shelf claims. */}
        <TextInput
          label="Sticker code"
          description="Whatever is printed on this shelf's own sticker. Scanning it in Put away files boxes here."
          placeholder="usually set by scanning"
          value={draft.code}
          onChange={(e) =>
            setDraft((d) => ({ ...d, code: e.currentTarget.value }))
          }
          error={codeClash}
        />
        <Button
          mt="xs"
          loading={busy}
          disabled={!draft.name.trim()}
          onClick={() => void save()}
        >
          {place ? "Save" : "Add place"}
        </Button>
        {place && (
          <Button
            variant="subtle"
            color="gray"
            leftSection={
              place.archived ? (
                <IconArchiveOff size={16} />
              ) : (
                <IconArchive size={16} />
              )
            }
            onClick={() => {
              void archiveLocation(place.id, !place.archived);
              onClose();
            }}
          >
            {place.archived ? "Restore this place" : "Archive this place"}
          </Button>
        )}
      </Stack>
    </ResponsiveSheet>
  );
}

/** A to-scale sketch of the grid, so the numbers mean something before saving. */
export function SlotPreview({ cols, rows }: { cols: number; rows: number }) {
  const names = slotNames({ id: "", name: "", parentId: null, cols, rows });
  // Beyond this the cells are too small to read and the point is lost.
  if (names.length > 64) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 4,
      }}
    >
      {names.map((name) => (
        <div
          key={name}
          style={{
            border: "1px solid var(--mantine-color-dimmed)",
            borderRadius: 4,
            padding: "6px 0",
            textAlign: "center",
            fontSize: 12,
            opacity: 0.75,
          }}
        >
          {name}
        </div>
      ))}
    </div>
  );
}
