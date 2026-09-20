/**
 * The shelf view — a virtual wall. Every bay side by side, every shelf
 * stacked bottom-up as it stands, every slot showing the box in it. The
 * question it answers is "where is it, and what's next to it", by looking
 * rather than reading.
 *
 * Reads the same places and placements as everything else; nothing here is
 * a separate model. A top-down map of the whole building can sit on top of
 * the same data later.
 */
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import type { BinState, LocationState } from "@shared/reducer";
import { IconArrowLeft } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useNavigate } from "react-router";
import { PhotoImg } from "~/components/PhotoImg";
import { boxPath, boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import { useBoxSizes } from "~/lib/boxSizes";
import { db } from "~/lib/db";
import {
  childrenOf,
  isGrid,
  placeSlots,
  useOccupancy,
  usePlaceMap,
} from "~/lib/places";
import { SizeIcon } from "~/lib/sizeIcons";

/** Height of one shelf unit in the drawing, px. */
const UNIT = 92;

export default function Shelves() {
  useDocumentTitle("Shelves · bins");
  const navigate = useNavigate();
  const byId = usePlaceMap();
  const occupancy = useOccupancy();
  const numbersInternal = useBoxNumbersInternal();
  const sizes = useBoxSizes();
  const sizeById = new Map(sizes.map((s) => [s.id, s]));

  // Roots worth drawing: places whose children are bays (have children of
  // their own) or shelves. Plain top-level places with nothing inside are
  // not a wall.
  const roots = childrenOf(byId, null).filter(
    (p) => childrenOf(byId, p.id).length > 0 || isGrid(p),
  );
  const [rootId, setRootId] = useState<string | null>(null);
  const root = (rootId ? byId.get(rootId) : undefined) ?? roots[0];

  // Boxes that are active but sit nowhere structured — "on the floor".
  const unplaced = useLiveQuery(
    async () =>
      (await db.bins.toArray()).filter(
        (b) => b.status === "active" && !b.locationId,
      ),
    [],
    [] as BinState[],
  );

  function open(bin: BinState) {
    navigate(boxPath(bin, numbersInternal));
  }

  // Under a root: bays that contain shelves, drawn as columns; shelves that
  // sit directly under the root, drawn as one column of their own.
  const bays = root ? childrenOf(byId, root.id) : [];
  const columns: { name: string; shelves: LocationState[] }[] = [];
  const loose: LocationState[] = [];
  for (const bay of bays) {
    const shelves = childrenOf(byId, bay.id);
    if (shelves.length > 0) columns.push({ name: bay.name, shelves });
    else loose.push(bay);
  }
  if (loose.length > 0)
    columns.push({ name: root?.name ?? "", shelves: loose });
  if (root && columns.length === 0 && isGrid(root))
    columns.push({ name: "", shelves: [root] });

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), calc(env(safe-area-inset-top) + var(--bins-banner-h, 0px)))"
      gap="md"
    >
      <Group justify="space-between">
        <Group gap="sm">
          <ActionIcon
            variant="default"
            size="xl"
            radius="xl"
            onClick={() =>
              (window.history.state?.idx ?? 0) > 0
                ? navigate(-1)
                : navigate("/")
            }
            aria-label="Back"
          >
            <IconArrowLeft />
          </ActionIcon>
          <Title order={3}>Shelves</Title>
        </Group>
        {roots.length > 1 && (
          <Select
            data={roots.map((r) => ({ value: r.id, label: r.name }))}
            value={root?.id ?? null}
            onChange={setRootId}
            allowDeselect={false}
            w={200}
          />
        )}
      </Group>

      {!root && (
        <Text c="dimmed">
          No shelves to draw yet. An admin sets up bays and shelves under Admin
          › Places.
        </Text>
      )}

      {root && (
        // Horizontal scroll, never wrapping: a wall is wider than a phone
        // and the columns must stay in their real order.
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <Group gap="sm" wrap="nowrap" align="flex-end">
            {columns.map((column) => (
              <Stack key={column.name} gap={6} style={{ flexShrink: 0 }}>
                {/* Top shelf first: the drawing stands the way the wall does. */}
                {[...column.shelves].reverse().map((shelf) => (
                  <Shelf
                    key={shelf.id}
                    shelf={shelf}
                    occupancy={occupancy}
                    numbersInternal={numbersInternal}
                    sizeIcon={(bin) =>
                      bin.sizeId ? sizeById.get(bin.sizeId)?.icon : undefined
                    }
                    onOpen={open}
                  />
                ))}
                <Text ta="center" fw={700}>
                  {column.name}
                </Text>
              </Stack>
            ))}
          </Group>
        </div>
      )}

      {unplaced.length > 0 && (
        <Paper p="sm" radius="md" withBorder>
          <Group justify="space-between" mb={6}>
            <Text fw={600} size="sm">
              Not on a shelf
            </Text>
            <Badge variant="light" color="gray">
              {unplaced.length}
            </Badge>
          </Group>
          <Group gap={6}>
            {unplaced.map((bin) => (
              <UnstyledButton key={bin.id} onClick={() => open(bin)}>
                <Badge
                  variant="outline"
                  color="gray"
                  style={{ textTransform: "none", cursor: "pointer" }}
                >
                  {boxTitle(bin, numbersInternal)}
                  {bin.locationName ? ` · ${bin.locationName}` : ""}
                </Badge>
              </UnstyledButton>
            ))}
          </Group>
        </Paper>
      )}
    </Stack>
  );
}

function Shelf({
  shelf,
  occupancy,
  numbersInternal,
  sizeIcon,
  onOpen,
}: {
  shelf: LocationState;
  occupancy: ReturnType<typeof useOccupancy>;
  numbersInternal: boolean;
  sizeIcon: (bin: BinState) => string | null | undefined;
  onOpen: (bin: BinState) => void;
}) {
  const here = occupancy.get(shelf.id);
  const grid = isGrid(shelf);
  const slots = grid ? placeSlots(shelf) : [];
  const height = UNIT * (shelf.span ?? 1);
  const count = here?.all.length ?? 0;
  const over = grid && count > slots.length;

  return (
    <Paper
      p={6}
      radius="md"
      withBorder
      style={{
        minHeight: height,
        width: grid ? Math.max(180, (shelf.cols ?? 1) * 64) : 200,
        borderColor: over ? "var(--mantine-color-red-6)" : undefined,
      }}
    >
      <Group justify="space-between" gap={4} mb={4}>
        <Text size="xs" fw={600}>
          {shelf.name}
        </Text>
        <Text size="xs" c={over ? "red" : "dimmed"}>
          {grid ? `${count}/${slots.length}` : count}
        </Text>
      </Group>
      {grid ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${shelf.cols}, 1fr)`,
            gap: 3,
          }}
        >
          {slots.map((slot) => {
            const boxes = here?.bySlot.get(slot) ?? [];
            const bin = boxes[0];
            return (
              <div
                key={slot}
                style={{
                  minHeight: 44,
                  borderRadius: 4,
                  border: "1px dashed var(--mantine-color-default-border)",
                  overflow: "hidden",
                }}
              >
                {bin ? (
                  <BoxCell
                    bin={bin}
                    extra={boxes.length - 1}
                    icon={sizeIcon(bin)}
                    numbersInternal={numbersInternal}
                    onOpen={onOpen}
                  />
                ) : (
                  <Text size="xs" c="dimmed" ta="center" pt={14}>
                    {slot}
                  </Text>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Group gap={3}>
          {(here?.all ?? []).map((bin) => (
            <BoxCell
              key={bin.id}
              bin={bin}
              extra={0}
              icon={sizeIcon(bin)}
              numbersInternal={numbersInternal}
              onOpen={onOpen}
              compact
            />
          ))}
        </Group>
      )}
      {here && here.unslotted.length > 0 && grid && (
        <Text size="xs" c="dimmed" mt={4}>
          + {here.unslotted.length} on this shelf, no slot
        </Text>
      )}
    </Paper>
  );
}

function BoxCell({
  bin,
  extra,
  icon,
  numbersInternal,
  onOpen,
  compact,
}: {
  bin: BinState;
  extra: number;
  icon: string | null | undefined;
  numbersInternal: boolean;
  onOpen: (bin: BinState) => void;
  compact?: boolean;
}) {
  const title = boxTitle(bin, numbersInternal);
  return (
    <UnstyledButton
      onClick={() => onOpen(bin)}
      aria-label={`Open ${title}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: "100%",
        padding: 3,
        background: "var(--mantine-color-default-hover)",
        borderRadius: 4,
        minHeight: compact ? 32 : 44,
      }}
    >
      {bin.primaryThumbHash || bin.primaryPhotoHash ? (
        <PhotoImg
          hash={bin.primaryPhotoHash as string}
          thumbHash={bin.primaryThumbHash}
          alt=""
          style={{ width: 28, height: 28, borderRadius: 4, flexShrink: 0 }}
        />
      ) : (
        <SizeIcon icon={icon} size={20} />
      )}
      <Text
        size="xs"
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {title}
        {extra > 0 ? ` +${extra}` : ""}
      </Text>
    </UnstyledButton>
  );
}
