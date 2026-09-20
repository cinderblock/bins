/**
 * Shelf builder — define the places boxes live in.
 *
 * Deliberately in admin: describing a building's shelving is a setup act, done
 * once at a desk, not something anyone does while holding a box.
 *
 * Nothing about any particular site is in this file. Places are op-driven rows
 * configured here and synced like everything else, so "H4 is 3 wide by 2 tall"
 * is data belonging to one deployment, never code in this repo.
 *
 * Two ways to add. One place at a time (a room, a trailer, a single shelf),
 * or a whole BAY: a column of numbered shelves, each with its own grid, in a
 * few taps — because a real wall is twelve bays of six shelves and nobody
 * should type seventy-two rows.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
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
import { Link } from "react-router";
import { archiveLocation, upsertLocation } from "~/lib/actions";
import { db } from "~/lib/db";
import { childrenOf } from "~/lib/places";

type Draft = {
  id: string | null;
  name: string;
  parentId: string | null;
  grid: boolean;
  cols: number;
  rows: number;
  span: number;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  parentId: null,
  grid: false,
  cols: 3,
  rows: 2,
  span: 1,
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
  // Listed by breadcrumb, numerically ("D2" before "D10"), so a bay's shelves
  // sit under it in order rather than interleaving by raw sort order.
  const visible = locations
    .filter((l) => showArchived || !l.archived)
    .sort((a, b) =>
      locationLabel(byId, a.id).localeCompare(
        locationLabel(byId, b.id),
        undefined,
        {
          numeric: true,
        },
      ),
    );

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
      span: draft.span > 1 ? draft.span : null,
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
      span: location.span ?? 1,
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
      <Group justify="space-between">
        <Group gap="xs">
          <IconLayoutGrid size={18} />
          <Text fw={600}>Places &amp; shelves</Text>
        </Group>
        <Button
          component={Link}
          to="/shelves"
          size="compact-sm"
          variant="light"
        >
          View the shelves
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Where boxes live. Give a shelf a grid and it gets numbered slots you can
        put boxes into; leave it off for a plain place like a room or a trailer.
        Nest shelves inside a bay and the shelf view draws the whole wall.
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
                {draftCapacity} slots, numbered 1–{draftCapacity} left to right,
                top to bottom.
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

      <BayBuilder locations={locations} byId={byId} />

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
                    {capacity == null && used > 0 && (
                      <Badge size="sm" variant="light" color="gray">
                        {used}
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

/** One numbered shelf in a bay being built. */
type ShelfRow = {
  number: number;
  grid: boolean;
  cols: number;
  rows: number;
  span: number;
};

function defaultRows(from: number, to: number): ShelfRow[] {
  const rows: ShelfRow[] = [];
  for (let n = from; n <= to; n++)
    rows.push({ number: n, grid: true, cols: 3, rows: 2, span: 1 });
  return rows;
}

/**
 * Build a whole bay — a parent place plus one child shelf per number, each
 * with its own grid — in one go. The numbers become the shelf names ("D0",
 * "D1", …) and the sort order, so the shelf view stacks them bottom-up.
 *
 * "Same as" copies an existing bay's shelves as the starting table, which is
 * how the second through twelfth bays of a wall take one tap each.
 */
function BayBuilder({
  locations,
  byId,
}: {
  locations: LocationState[];
  byId: Map<string, LocationState>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(5);
  const [rows, setRows] = useState<ShelfRow[]>(defaultRows(0, 5));
  const [busy, setBusy] = useState(false);

  function resize(nextFrom: number, nextTo: number) {
    setFrom(nextFrom);
    setTo(nextTo);
    setRows((prev) => {
      const byNumber = new Map(prev.map((r) => [r.number, r]));
      return defaultRows(nextFrom, nextTo).map(
        (r) => byNumber.get(r.number) ?? r,
      );
    });
  }

  // Bays = places that have children. Copying one seeds the table from its
  // shelves, numbered by their position in the bay.
  const bays = locations.filter(
    (l) => !l.archived && childrenOf(byId, l.id).length > 0,
  );
  function copyFrom(bayId: string | null) {
    if (!bayId) return;
    const shelves = childrenOf(byId, bayId);
    const numbers = shelves.map((s) => {
      const m = s.name.match(/(\d+)\s*$/);
      return m ? Number(m[1]) : s.sortOrder;
    });
    const lo = Math.min(...numbers);
    const hi = Math.max(...numbers);
    setFrom(lo);
    setTo(hi);
    setRows(
      defaultRows(lo, hi).map((r) => {
        const at = numbers.indexOf(r.number);
        const s = at >= 0 ? shelves[at] : undefined;
        return s
          ? {
              number: r.number,
              grid: s.cols != null && s.rows != null,
              cols: s.cols ?? 3,
              rows: s.rows ?? 2,
              span: s.span ?? 1,
            }
          : r;
      }),
    );
  }

  function update(number: number, patch: Partial<ShelfRow>) {
    setRows((prev) =>
      prev.map((r) => (r.number === number ? { ...r, ...patch } : r)),
    );
  }

  async function build() {
    const bay = name.trim();
    if (!bay) return;
    setBusy(true);
    try {
      const bayId = crypto.randomUUID();
      // The bay itself sits after everything at its level.
      const siblings = childrenOf(byId, parentId, true);
      const baySort =
        siblings.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
      await upsertLocation(bayId, bay, baySort, { parentId });
      for (const row of rows) {
        await upsertLocation(
          crypto.randomUUID(),
          `${bay}${row.number}`,
          row.number,
          {
            parentId: bayId,
            cols: row.grid ? row.cols : null,
            rows: row.grid ? row.rows : null,
            span: row.span > 1 ? row.span : null,
          },
        );
      }
      notifications.show({
        message: `Added bay ${bay} with ${rows.length} shelves`,
        color: "green",
      });
      setName("");
    } finally {
      setBusy(false);
    }
  }

  const parentOptions = locations
    .filter((l) => !l.archived)
    .map((l) => ({ value: l.id, label: locationLabel(byId, l.id) || l.name }));

  if (!open) {
    return (
      <Button
        variant="light"
        leftSection={<IconPlus size={16} />}
        onClick={() => setOpen(true)}
        style={{ alignSelf: "flex-start" }}
      >
        Add a bay of shelves
      </Button>
    );
  }

  return (
    <Paper p="sm" radius="md" withBorder>
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Add a bay of shelves
        </Text>
        <Text size="xs" c="dimmed">
          A bay is one column of numbered shelves. Shelf names are the bay name
          plus the number, so bay "D" with shelves 0–5 makes D0 … D5, numbered
          from the bottom.
        </Text>
        <Group grow>
          <TextInput
            label="Bay name"
            placeholder="e.g. D"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Select
            label="Inside"
            placeholder="Nowhere in particular"
            data={parentOptions}
            value={parentId}
            onChange={setParentId}
            clearable
            searchable
          />
        </Group>
        <Group grow>
          <NumberInput
            label="Bottom shelf number"
            min={0}
            max={99}
            value={from}
            onChange={(v) => resize(Math.min(Number(v) || 0, to), to)}
          />
          <NumberInput
            label="Top shelf number"
            min={0}
            max={99}
            value={to}
            onChange={(v) => resize(from, Math.max(Number(v) || 0, from))}
          />
          {bays.length > 0 && (
            <Select
              label="Same shelves as"
              placeholder="an existing bay"
              data={bays.map((b) => ({ value: b.id, label: b.name }))}
              onChange={copyFrom}
              clearable
            />
          )}
        </Group>
        <Table withRowBorders={false} verticalSpacing={2}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Shelf</Table.Th>
              <Table.Th>Slots</Table.Th>
              <Table.Th>Across</Table.Th>
              <Table.Th>Stacked</Table.Th>
              <Table.Th>Height</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...rows].reverse().map((row) => (
              <Table.Tr key={row.number}>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {name.trim() || "?"}
                    {row.number}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Checkbox
                    checked={row.grid}
                    onChange={(e) =>
                      update(row.number, { grid: e.currentTarget.checked })
                    }
                    aria-label="Holds boxes in numbered slots"
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs"
                    min={1}
                    max={64}
                    w={64}
                    disabled={!row.grid}
                    value={row.cols}
                    onChange={(v) =>
                      update(row.number, { cols: Number(v) || 1 })
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs"
                    min={1}
                    max={64}
                    w={64}
                    disabled={!row.grid}
                    value={row.rows}
                    onChange={(v) =>
                      update(row.number, { rows: Number(v) || 1 })
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs"
                    min={1}
                    max={8}
                    w={64}
                    value={row.span}
                    onChange={(v) =>
                      update(row.number, { span: Number(v) || 1 })
                    }
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed">
          Top shelf first, like the wall. "Stacked" is how many boxes sit on top
          of each other; "Height" only changes the drawing.
        </Text>
        <Group justify="space-between">
          <Button variant="subtle" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            loading={busy}
            disabled={!name.trim() || rows.length === 0}
            onClick={() => void build()}
          >
            Add {rows.length} shelves
          </Button>
        </Group>
      </Stack>
    </Paper>
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
