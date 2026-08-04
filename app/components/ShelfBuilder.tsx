/**
 * Shelf builder — define the places boxes live in.
 *
 * Deliberately in admin: describing a building's shelving is a setup act, done
 * once at a desk, not something anyone does while holding a box.
 *
 * Nothing about any particular site is in this file. Places are op-driven rows
 * configured here and synced like everything else, so "H4 is 3 wide by 2 tall"
 * is data belonging to one deployment, never code in this repo.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  locationLabel,
  slotCapacity,
  slotNames,
  wouldCycle,
} from "@shared/locations";
import type { LocationState } from "@shared/reducer";
import {
  IconArchive,
  IconArchiveOff,
  IconLayoutGrid,
  IconPlus,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { archiveLocation, upsertLocation } from "~/lib/actions";
import { db } from "~/lib/db";

type Draft = {
  id: string | null;
  name: string;
  parentId: string | null;
  grid: boolean;
  cols: number;
  rows: number;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  parentId: null,
  grid: false,
  cols: 3,
  rows: 2,
};

export function ShelfBuilder() {
  const locations = useLiveQuery(
    () => db.locations.orderBy("sortOrder").toArray(),
    [],
    [] as LocationState[],
  );
  // How many boxes currently sit in each place — the builder's most useful
  // signal, because it says whether a shelf can safely be resized or archived.
  const occupancy = useLiveQuery(
    async () => {
      const counts = new Map<string, number>();
      for (const bin of await db.bins.toArray()) {
        if (bin.status !== "active" || !bin.locationId) continue;
        counts.set(bin.locationId, (counts.get(bin.locationId) ?? 0) + 1);
      }
      return counts;
    },
    [],
    new Map<string, number>(),
  );

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [showArchived, setShowArchived] = useState(false);

  const byId = new Map(locations.map((l) => [l.id, l]));
  const visible = locations.filter((l) => showArchived || !l.archived);

  async function save() {
    const name = draft.name.trim();
    if (!name) return;
    const id = draft.id ?? crypto.randomUUID();
    // Refuse a loop before writing. The walk helpers survive one either way,
    // but a builder that lets you create one is just handing you broken data.
    if (draft.id && wouldCycle(byId, draft.id, draft.parentId)) {
      notifications.show({
        message: "That would put a place inside itself",
        color: "red",
      });
      return;
    }
    const sortOrder = draft.id
      ? (byId.get(draft.id)?.sortOrder ?? 0)
      : locations.length;
    await upsertLocation(id, name, sortOrder, {
      parentId: draft.parentId,
      cols: draft.grid ? draft.cols : null,
      rows: draft.grid ? draft.rows : null,
    });
    setDraft(EMPTY);
  }

  function edit(location: LocationState) {
    setDraft({
      id: location.id,
      name: location.name,
      parentId: location.parentId,
      grid: location.cols != null && location.rows != null,
      cols: location.cols ?? 3,
      rows: location.rows ?? 2,
    });
  }

  // A place can't be its own parent, and can't sit under its own descendant.
  const parentOptions = locations
    .filter((l) => !l.archived)
    .filter((l) => !draft.id || !wouldCycle(byId, draft.id, l.id))
    .map((l) => ({ value: l.id, label: locationLabel(byId, l.id) || l.name }));

  const draftCapacity = draft.grid ? draft.cols * draft.rows : null;

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <IconLayoutGrid size={18} />
        <Text fw={600}>Places &amp; shelves</Text>
      </Group>
      <Text size="xs" c="dimmed">
        Where boxes live. Give a shelf a grid and it gets numbered slots you can
        put boxes into; leave it off for a plain place like a room or a trailer.
      </Text>

      <Paper p="sm" radius="md" withBorder>
        <Stack gap="xs">
          <TextInput
            label={draft.id ? "Rename place" : "New place"}
            placeholder="e.g. H4"
            value={draft.name}
            onChange={(e) =>
              setDraft((d) => ({ ...d, name: e.currentTarget.value }))
            }
          />
          <Select
            label="Inside"
            placeholder="Nowhere in particular"
            data={parentOptions}
            value={draft.parentId}
            onChange={(v) => setDraft((d) => ({ ...d, parentId: v }))}
            clearable
            searchable
          />
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
                  label="High"
                  min={1}
                  max={64}
                  value={draft.rows}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, rows: Number(v) || 1 }))
                  }
                />
              </Group>
              <Text size="xs" c="dimmed">
                {draftCapacity} slots, numbered 1–{draftCapacity} left to right,
                top to bottom.
              </Text>
              <SlotPreview cols={draft.cols} rows={draft.rows} />
            </>
          )}
          <Group justify="space-between">
            {draft.id ? (
              <Button variant="subtle" onClick={() => setDraft(EMPTY)}>
                Cancel
              </Button>
            ) : (
              <span />
            )}
            <Button
              leftSection={draft.id ? undefined : <IconPlus size={16} />}
              onClick={() => void save()}
              disabled={!draft.name.trim()}
            >
              {draft.id ? "Save" : "Add place"}
            </Button>
          </Group>
        </Stack>
      </Paper>

      {locations.some((l) => l.archived) && (
        <Switch
          size="xs"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.currentTarget.checked)}
          label="Show archived"
        />
      )}

      <Stack gap={4}>
        {visible.length === 0 && (
          <Text size="sm" c="dimmed">
            No places yet.
          </Text>
        )}
        {visible.map((location) => {
          const capacity = slotCapacity(location);
          const used = occupancy.get(location.id) ?? 0;
          return (
            <Paper key={location.id} p="xs" radius="md" withBorder>
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600} truncate>
                      {location.name}
                    </Text>
                    {capacity != null && (
                      // Over capacity is possible and worth showing rather
                      // than hiding: a shelf can be shrunk after boxes are on
                      // it, and nothing rewrites their slots when it is.
                      <Badge
                        size="sm"
                        variant="light"
                        color={used > capacity ? "red" : "gray"}
                      >
                        {used}/{capacity}
                      </Badge>
                    )}
                    {location.archived && (
                      <Badge size="sm" color="gray">
                        archived
                      </Badge>
                    )}
                  </Group>
                  {location.parentId && (
                    <Text size="xs" c="dimmed" truncate>
                      {locationLabel(byId, location.parentId)}
                    </Text>
                  )}
                </div>
                <Group gap={4} wrap="nowrap">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => edit(location)}
                  >
                    Edit
                  </Button>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={location.archived ? "Restore" : "Archive"}
                    onClick={() =>
                      void archiveLocation(location.id, !location.archived)
                    }
                  >
                    {location.archived ? (
                      <IconArchiveOff size={16} />
                    ) : (
                      <IconArchive size={16} />
                    )}
                  </ActionIcon>
                </Group>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}

/** A to-scale sketch of the grid, so the numbers mean something before saving. */
function SlotPreview({ cols, rows }: { cols: number; rows: number }) {
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
