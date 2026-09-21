/**
 * The shelf view — a virtual wall. Every bay side by side, every shelf
 * stacked bottom-up as it stands, every slot showing the box in it. The
 * question it answers is "where is it, and what's next to it", by looking
 * rather than reading.
 *
 * Reads the same places and placements as everything else; nothing here is
 * a separate model. A top-down map of the whole building can sit on top of
 * the same data later.
 *
 * It is also where an admin FIXES what they are looking at. Noticing that a
 * shelf is mislabelled, or that a box is on the wrong one, happens here —
 * so the edits happen here too, on hover, instead of sending someone to
 * find the same shelf again in a settings page. On touch, where there is no
 * hover, the box cells stay plain taps through to the box; the shelf and
 * bay pencils are simply always visible.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { BinState, LocationState } from "@shared/reducer";
import {
  IconArrowLeft,
  IconBoxMultiple,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconQrcode,
  IconSettings,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { BoxQuickEdit } from "~/components/BoxQuickEdit";
import { LocationSheet } from "~/components/LocationSheet";
import { PhotoImg } from "~/components/PhotoImg";
import { PlaceEditSheet } from "~/components/PlaceEditSheet";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { setBinLocation } from "~/lib/actions";
import { useAdminPassword } from "~/lib/admin";
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
import { HOVER_ACTIONS, HOVER_ONLY, HOVER_PARENT } from "~/lib/ui";

/** Height of one shelf unit in the drawing, px. */
const UNIT = 92;

/**
 * What an admin can do to the thing under the pointer. Passed down rather
 * than threaded as six separate props — every level of the drawing offers
 * the same small set, and `unlocked` gates all of it.
 */
type WallActions = {
  unlocked: boolean;
  editPlace: (place: LocationState) => void;
  editBin: (bin: BinState) => void;
  moveBin: (bin: BinState) => void;
  fillSlot: (shelf: LocationState, slot: string) => void;
};

export default function Shelves() {
  useDocumentTitle("Shelves · bins");
  const navigate = useNavigate();
  const location = useLocation();
  // Whether this IS the home surface, which decides the header — see below.
  const atHome = location.pathname === "/";
  const byId = usePlaceMap();
  const occupancy = useOccupancy();
  const numbersInternal = useBoxNumbersInternal();
  const sizes = useBoxSizes();
  const sizeById = new Map(sizes.map((s) => [s.id, s]));
  const unlocked = typeof useAdminPassword() === "string";

  // Roots worth drawing: places whose children are bays (have children of
  // their own) or shelves. Plain top-level places with nothing inside are
  // not a wall.
  const roots = childrenOf(byId, null).filter(
    (p) => childrenOf(byId, p.id).length > 0 || isGrid(p),
  );
  const [rootId, setRootId] = useState<string | null>(null);
  const root = (rootId ? byId.get(rootId) : undefined) ?? roots[0];

  // The edit surfaces, all of them opened from something on the wall.
  // `newPlace` is separate from `editPlace` so "add" and "edit" can't be
  // confused for one another when both are null.
  const [editPlace, setEditPlace] = useState<LocationState | null>(null);
  const [newPlaceUnder, setNewPlaceUnder] = useState<string | null | undefined>(
    undefined,
  );
  const [editBin, setEditBin] = useState<BinState | null>(null);
  const [moveBin, setMoveBin] = useState<BinState | null>(null);
  const [fill, setFill] = useState<{
    shelf: LocationState;
    slot: string;
  } | null>(null);

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

  const actions: WallActions = {
    unlocked,
    editPlace: setEditPlace,
    editBin: setEditBin,
    moveBin: setMoveBin,
    fillSlot: (shelf, slot) => setFill({ shelf, slot }),
  };

  // Under a root: bays that contain shelves, drawn as columns; shelves that
  // sit directly under the root, drawn as one column of their own. Each
  // column remembers the PLACE it came from, so its heading is editable.
  const bays = root ? childrenOf(byId, root.id) : [];
  const columns: {
    place: LocationState | null;
    name: string;
    shelves: LocationState[];
  }[] = [];
  const loose: LocationState[] = [];
  for (const bay of bays) {
    const shelves = childrenOf(byId, bay.id);
    if (shelves.length > 0)
      columns.push({ place: bay, name: bay.name, shelves });
    else loose.push(bay);
  }
  if (loose.length > 0)
    columns.push({
      place: root ?? null,
      name: root?.name ?? "",
      shelves: loose,
    });
  if (root && columns.length === 0 && isGrid(root))
    columns.push({ place: root, name: "", shelves: [root] });

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), calc(env(safe-area-inset-top) + var(--bins-banner-h, 0px)))"
      gap="md"
    >
      <Group justify="space-between">
        <Group gap="sm">
          {/* No back arrow when this IS the home surface — "back" from the
              home screen leaves the app. Same rule as the box list. */}
          {!atHome && (
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
          )}
          <Title order={3}>Shelves</Title>
        </Group>
        <Group gap="xs">
          {roots.length > 1 && (
            <Select
              data={roots.map((r) => ({ value: r.id, label: r.name }))}
              value={root?.id ?? null}
              onChange={setRootId}
              allowDeselect={false}
              w={160}
            />
          )}
          {/* Adding a shelf to the wall you are standing in front of. The
              full builder (bays in bulk, archived places) is still in admin;
              this is the one-off. */}
          {unlocked && (
            <Button
              size="sm"
              radius="xl"
              variant="light"
              leftSection={<IconPlus size={18} />}
              onClick={() => setNewPlaceUnder(root?.id ?? null)}
            >
              Add a place
            </Button>
          )}
          {/* A shelves-home deployment reaches everything from here, so the
              same three ways on as the box list has. */}
          <ActionIcon
            variant="default"
            size="xl"
            radius="xl"
            aria-label="All boxes"
            onClick={() => navigate("/bins")}
          >
            <IconBoxMultiple />
          </ActionIcon>
          <ActionIcon
            variant="default"
            size="xl"
            radius="xl"
            aria-label="Scan"
            onClick={() => navigate("/scan")}
          >
            <IconQrcode />
          </ActionIcon>
          <ActionIcon
            variant="default"
            size="xl"
            radius="xl"
            aria-label="Settings"
            onClick={() => navigate("/settings")}
          >
            <IconSettings />
          </ActionIcon>
        </Group>
      </Group>

      {!root && (
        <Text c="dimmed">
          No shelves to draw yet.{" "}
          {unlocked
            ? "“Add a place” above starts one, or build a whole bay in Admin › Places."
            : "An admin sets up bays and shelves under Admin › Places."}
        </Text>
      )}

      {root && (
        // Horizontal scroll, never wrapping: a wall is wider than a phone
        // and the columns must stay in their real order.
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <Group gap="sm" wrap="nowrap" align="flex-end">
            {columns.map((column) => (
              <Stack
                key={column.place?.id ?? column.name}
                gap={6}
                style={{ flexShrink: 0 }}
              >
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
                    actions={actions}
                  />
                ))}
                <Group
                  gap={4}
                  justify="center"
                  wrap="nowrap"
                  className={HOVER_PARENT}
                >
                  <Text ta="center" fw={700}>
                    {column.name}
                  </Text>
                  {unlocked && column.place && column.name && (
                    <ActionIcon
                      className={HOVER_ACTIONS}
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Edit ${column.name}`}
                      onClick={() => column.place && setEditPlace(column.place)}
                    >
                      <IconPencil size={14} />
                    </ActionIcon>
                  )}
                </Group>
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
              <Group
                key={bin.id}
                gap={2}
                wrap="nowrap"
                className={HOVER_PARENT}
              >
                <UnstyledButton onClick={() => open(bin)}>
                  <Badge
                    variant="outline"
                    color="gray"
                    style={{ textTransform: "none", cursor: "pointer" }}
                  >
                    {boxTitle(bin, numbersInternal)}
                    {bin.locationName ? ` · ${bin.locationName}` : ""}
                  </Badge>
                </UnstyledButton>
                {/* The whole point of this shelf is emptying it. */}
                {unlocked && (
                  <ActionIcon
                    className={HOVER_ACTIONS}
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label={`Put ${boxTitle(bin, numbersInternal)} somewhere`}
                    onClick={() => setMoveBin(bin)}
                  >
                    <IconMapPin size={14} />
                  </ActionIcon>
                )}
              </Group>
            ))}
          </Group>
        </Paper>
      )}

      <PlaceEditSheet
        place={editPlace}
        opened={editPlace !== null}
        onClose={() => setEditPlace(null)}
      />
      <PlaceEditSheet
        place={null}
        defaultParentId={newPlaceUnder ?? null}
        opened={newPlaceUnder !== undefined}
        onClose={() => setNewPlaceUnder(undefined)}
      />
      {editBin && (
        <BoxQuickEdit bin={editBin} onClose={() => setEditBin(null)} />
      )}
      {moveBin && (
        <LocationSheet bin={moveBin} opened onClose={() => setMoveBin(null)} />
      )}
      {fill && (
        <SlotFillSheet
          shelf={fill.shelf}
          slot={fill.slot}
          onClose={() => setFill(null)}
        />
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
  actions,
}: {
  shelf: LocationState;
  occupancy: ReturnType<typeof useOccupancy>;
  numbersInternal: boolean;
  sizeIcon: (bin: BinState) => string | null | undefined;
  onOpen: (bin: BinState) => void;
  actions: WallActions;
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
      {/* The header strip is the hover target, not the whole card: a card-
          wide target would also reveal every box cell's overlay inside it. */}
      <Group
        justify="space-between"
        gap={4}
        mb={4}
        wrap="nowrap"
        className={HOVER_PARENT}
      >
        <Text size="xs" fw={600} truncate>
          {shelf.name}
        </Text>
        <Group gap={2} wrap="nowrap">
          {actions.unlocked && (
            <ActionIcon
              className={HOVER_ACTIONS}
              size="xs"
              variant="subtle"
              color="gray"
              aria-label={`Edit ${shelf.name}`}
              onClick={() => actions.editPlace(shelf)}
            >
              <IconPencil size={13} />
            </ActionIcon>
          )}
          <Text size="xs" c={over ? "red" : "dimmed"}>
            {grid ? `${count}/${slots.length}` : count}
          </Text>
        </Group>
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
                    actions={actions}
                  />
                ) : actions.unlocked ? (
                  // An empty slot is a place to put something, so it is a
                  // target rather than a label. Plain tap on touch too — no
                  // overlay to miss.
                  <UnstyledButton
                    onClick={() => actions.fillSlot(shelf, slot)}
                    aria-label={`Put a box in ${shelf.name} slot ${slot}`}
                    className={HOVER_PARENT}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      width: "100%",
                      minHeight: 44,
                    }}
                  >
                    <Text size="xs" c="dimmed">
                      {slot}
                    </Text>
                    {/* No inline opacity here: an inline style outranks
                        the stylesheet, which is exactly how this shipped
                        visible on every slot the first time. */}
                    <IconPlus size={12} className={HOVER_ONLY} />
                  </UnstyledButton>
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
              actions={actions}
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
  actions,
  compact,
}: {
  bin: BinState;
  extra: number;
  icon: string | null | undefined;
  numbersInternal: boolean;
  onOpen: (bin: BinState) => void;
  actions: WallActions;
  compact?: boolean;
}) {
  const title = boxTitle(bin, numbersInternal);
  return (
    <div
      className={HOVER_PARENT}
      style={{ position: "relative", width: "100%", minWidth: 0 }}
    >
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
      {/* Hover-only: these sit ON the cell, and a slot is ~58px wide — left
          permanently visible they'd cover the box's name on every phone.
          Touch reaches the same edits by tapping into the box. */}
      {actions.unlocked && (
        <Group
          gap={0}
          wrap="nowrap"
          className={HOVER_ONLY}
          style={{
            position: "absolute",
            top: 1,
            right: 1,
            borderRadius: 4,
            background: "var(--mantine-color-body)",
            boxShadow: "0 0 0 1px var(--mantine-color-default-border)",
          }}
        >
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={`Move ${title}`}
            onClick={() => actions.moveBin(bin)}
          >
            <IconMapPin size={13} />
          </ActionIcon>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={`Edit ${title}`}
            onClick={() => actions.editBin(bin)}
          >
            <IconPencil size={13} />
          </ActionIcon>
        </Group>
      )}
    </div>
  );
}

/**
 * "Which box goes in this slot?" — the other direction from the location
 * picker, which starts at a box and asks where. Standing at the wall, the
 * empty slot is what you are looking at.
 *
 * Boxes that are nowhere come first: an empty slot is usually being filled
 * from the floor, not robbed from another shelf.
 */
function SlotFillSheet({
  shelf,
  slot,
  onClose,
}: {
  shelf: LocationState;
  slot: string;
  onClose: () => void;
}) {
  const numbersInternal = useBoxNumbersInternal();
  const [query, setQuery] = useState("");
  const bins = useLiveQuery(
    async () =>
      (await db.bins.orderBy("id").toArray()).filter(
        (b) => b.status === "active",
      ),
    [],
    [] as BinState[],
  );

  const needle = query.trim().toLowerCase();
  const matches = bins
    .filter(
      (bin) =>
        !needle ||
        String(bin.id).includes(needle) ||
        (bin.name ?? "").toLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        Number(a.locationId != null) - Number(b.locationId != null) ||
        a.id - b.id,
    )
    .slice(0, 40);

  async function put(bin: BinState) {
    await setBinLocation(bin.id, { locationId: shelf.id, slot });
    notifications.show({
      message: `${boxTitle(bin, numbersInternal)} → ${shelf.name} · slot ${slot}`,
      color: "green",
    });
    onClose();
  }

  return (
    <ResponsiveSheet
      opened
      onClose={onClose}
      title={`Put a box in ${shelf.name} · slot ${slot}`}
      dismissLabel="Cancel"
    >
      <Stack gap="xs" pb="env(safe-area-inset-bottom)">
        <TextInput
          placeholder="Box number or name…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          autoFocus
        />
        {matches.length === 0 && (
          <Text size="sm" c="dimmed">
            No box matches that.
          </Text>
        )}
        {matches.map((bin) => (
          <Button
            key={bin.id}
            variant="light"
            justify="space-between"
            onClick={() => void put(bin)}
            rightSection={
              bin.locationId ? (
                <Text size="xs" c="dimmed">
                  currently placed
                </Text>
              ) : null
            }
          >
            {boxTitle(bin, numbersInternal)}
          </Button>
        ))}
      </Stack>
    </ResponsiveSheet>
  );
}
