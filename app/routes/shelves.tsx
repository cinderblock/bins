/**
 * The shelf view — a virtual wall. Every bay side by side, every shelf
 * stacked bottom-up as it stands, every slot showing the box in it. The
 * question it answers is "where is it, and what's next to it", by looking
 * rather than reading.
 *
 * Reads the same places and placements as everything else; nothing here is
 * a separate model.
 *
 * Above the walls sits the floor plan: a SPACE (a place with a plan, or deep
 * enough to hold walls) draws as a top-down map instead, and tapping a wall
 * on it comes back here to that wall's elevation. `?place=` says which;
 * `?find=<box>` / `?at=<place>` point at something on either view.
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
import { planKind } from "@shared/floorplan";
import { locationLabel, locationPath } from "@shared/locations";
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
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { BoxQuickEdit } from "~/components/BoxQuickEdit";
import { FloorPlanView, type PointAt } from "~/components/FloorPlanView";
import { LocationSheet } from "~/components/LocationSheet";
import { NewSpaceSheet } from "~/components/NewSpaceSheet";
import { PhotoImg } from "~/components/PhotoImg";
import { PlaceEditSheet } from "~/components/PlaceEditSheet";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { setBinLocation } from "~/lib/actions";
import { useAdminPassword } from "~/lib/admin";
import { boxPath, boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import { useBoxSizes } from "~/lib/boxSizes";
import { db } from "~/lib/db";
import { usePlanData } from "~/lib/floorplan";
import { childrenOf, isGrid, placeSlots, useOccupancy } from "~/lib/places";
import { SizeIcon } from "~/lib/sizeIcons";
import { HOVER_ACTIONS, HOVER_ONLY, HOVER_PARENT } from "~/lib/ui";

/** Height of one shelf unit in the drawing, px. */
const UNIT = 92;

/** The ring around whatever a "show me" link pointed at. */
const POINTED_RING = "0 0 0 3px var(--mantine-color-yellow-5)";

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
  /** What a "show me" link is pointing at: a box, or a shelf. */
  pointAt: { binId: number | null; placeId: string | null };
};

export default function Shelves() {
  useDocumentTitle("Shelves · bins");
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Whether this IS the home surface, which decides the header — see below.
  const atHome = location.pathname === "/";
  const plans = usePlanData();
  const byId = plans.byId;
  const occupancy = useOccupancy();
  const numbersInternal = useBoxNumbersInternal();
  const sizes = useBoxSizes();
  const sizeById = new Map(sizes.map((s) => [s.id, s]));
  const unlocked = typeof useAdminPassword() === "string";

  // What can be drawn. SPACES draw as a floor plan. WALLS draw as an
  // elevation: anything whose children are bays, plus — as before the map
  // existed — a top-level bay or shelf, and a bay standing loose in a space.
  // Plain places with nothing inside are neither.
  const spaces: LocationState[] = [];
  const walls: LocationState[] = [];
  for (const p of byId.values()) {
    if (p.archived) continue;
    const kind = planKind(plans.index, p);
    if (kind === "space") spaces.push(p);
    else if (kind === "wall") walls.push(p);
    else if (kind === "bay" || (kind === "zone" && isGrid(p))) {
      const parent = p.parentId ? byId.get(p.parentId) : undefined;
      if (!p.parentId || (parent && planKind(plans.index, parent) === "space"))
        walls.push(p);
    }
  }
  const byLabel = (a: LocationState, b: LocationState) =>
    locationLabel(byId, a.id).localeCompare(
      locationLabel(byId, b.id),
      undefined,
      { numeric: true },
    ) || a.sortOrder - b.sortOrder;
  spaces.sort(byLabel);
  walls.sort(byLabel);
  const topWalls = walls.filter((w) => !w.parentId);

  const requested = params.get("place");
  const selected =
    (requested ? byId.get(requested) : undefined) ??
    spaces.find((s) => !s.parentId) ??
    spaces[0] ??
    childrenOf(byId, null).find((p) => walls.includes(p)) ??
    walls[0];
  const selectedIsSpace =
    selected !== undefined && planKind(plans.index, selected) === "space";
  const root = selectedIsSpace ? undefined : selected;
  // The space a wall stands in, for the way back to its map.
  const homeSpace = root
    ? [...locationPath(byId, root.id)]
        .reverse()
        .slice(1)
        .find((p) => spaces.some((s) => s.id === p.id))
    : undefined;

  const findId = Number(params.get("find")) || null;
  const findBin = useLiveQuery(
    async () => (findId ? await db.bins.get(findId) : undefined),
    [findId],
  );
  const atPlace = params.get("at");
  const pointAt: PointAt | null = findBin
    ? { bin: findBin }
    : atPlace
      ? { placeId: atPlace }
      : null;

  function go(placeId: string, point?: PointAt) {
    const next = new URLSearchParams({ place: placeId });
    if (point?.bin) next.set("find", String(point.bin.id));
    else if (point?.placeId) next.set("at", point.placeId);
    navigate(`${location.pathname}?${next}`);
  }
  function clearPoint() {
    const next = new URLSearchParams(params);
    next.delete("find");
    next.delete("at");
    navigate(`${location.pathname}?${next}`, { replace: true });
  }
  const [newSpace, setNewSpace] = useState(false);

  // The edit surfaces, opened from something on the wall (or, for a new
  // place, from the empty state when there is no wall yet).
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
    pointAt: { binId: findBin?.id ?? null, placeId: atPlace },
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
          {spaces.length + walls.length > 1 && (
            <Select
              aria-label="Which floor plan or wall"
              data={[
                ...(spaces.length
                  ? [
                      {
                        group: "Floor plans",
                        items: spaces.map((r) => ({
                          value: r.id,
                          label: locationLabel(byId, r.id),
                        })),
                      },
                    ]
                  : []),
                {
                  group: "Walls",
                  items: walls.map((r) => ({
                    value: r.id,
                    label: locationLabel(byId, r.id),
                  })),
                },
              ]}
              value={selected?.id ?? null}
              onChange={(id) => id && go(id)}
              allowDeselect={false}
              searchable={spaces.length + walls.length > 8}
              w={200}
            />
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

      {/* Places change rarely — a wall is set up once and then lived in —
          so adding one is offered only here, where there is nothing to draw.
          Once a wall exists, new places come from Settings or the admin
          shelf builder, not from a button in the header of every visit. */}
      {/* Several walls and nowhere to say how they stand relative to each
          other: the one moment the floor plan is worth offering unasked.
          Once any space exists, new ones come from the place editor. */}
      {unlocked && spaces.length === 0 && topWalls.length >= 2 && (
        <Paper p="sm" radius="md" withBorder>
          <Group justify="space-between" gap="xs">
            <Text size="sm">
              {topWalls.length} walls, but nothing says where they stand in the
              room.
            </Text>
            <Button size="xs" variant="light" onClick={() => setNewSpace(true)}>
              Lay them out on a floor plan
            </Button>
          </Group>
        </Paper>
      )}

      {selectedIsSpace && selected && (
        <FloorPlanView
          key={selected.id}
          space={selected}
          pointAt={pointAt}
          startEditing={Boolean(
            (location.state as { editPlan?: boolean } | null)?.editPlan,
          )}
          onOpenPlace={go}
          onClearFind={clearPoint}
        />
      )}

      {homeSpace && (
        <Group gap={4}>
          <Button
            size="compact-sm"
            variant="subtle"
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => go(homeSpace.id, pointAt ?? undefined)}
          >
            {homeSpace.name} floor plan
          </Button>
          {root && (
            <Text size="sm" c="dimmed">
              › {root.name}
            </Text>
          )}
        </Group>
      )}

      {!selected && (
        <Stack gap="sm" align="flex-start">
          <Text c="dimmed">
            No shelves to draw yet.{" "}
            {unlocked
              ? "Start with one place here, or build a whole bay in Admin › Places."
              : "An admin sets up bays and shelves under Admin › Places."}
          </Text>
          {unlocked && (
            <Button
              size="sm"
              radius="xl"
              variant="light"
              leftSection={<IconPlus size={18} />}
              onClick={() => setNewPlaceUnder(null)}
            >
              Add a place
            </Button>
          )}
        </Stack>
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

      {unplaced.length > 0 && !selectedIsSpace && (
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

      <NewSpaceSheet
        opened={newSpace}
        onClose={() => setNewSpace(false)}
        candidates={topWalls}
        nextSortOrder={byId.size}
        onCreated={(id) => {
          setNewSpace(false);
          navigate(`${location.pathname}?place=${id}`, {
            state: { editPlan: true },
          });
        }}
      />
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
  const { binId: pointedBin, placeId: pointedPlace } = actions.pointAt;
  const pointedShelf = pointedPlace === shelf.id;
  const holdsPointed =
    pointedBin !== null &&
    (here?.all.some((b) => b.id === pointedBin) ?? false);

  // Bring the pointed-at shelf or slot into view once, when it becomes the
  // target — a wall is wider than a phone, and the point is not to hunt.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pointedShelf && !holdsPointed) return;
    const el = ref.current?.querySelector("[data-pointed]") ?? ref.current;
    el?.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
  }, [pointedShelf, holdsPointed]);

  return (
    <Paper
      ref={ref}
      p={6}
      radius="md"
      withBorder
      style={{
        minHeight: height,
        width: grid ? Math.max(180, (shelf.cols ?? 1) * 64) : 200,
        borderColor: over ? "var(--mantine-color-red-6)" : undefined,
        boxShadow: pointedShelf ? POINTED_RING : undefined,
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
            const pointed = boxes.some((b) => b.id === pointedBin);
            return (
              <div
                key={slot}
                data-pointed={pointed || undefined}
                style={{
                  minHeight: 44,
                  borderRadius: 4,
                  border: "1px dashed var(--mantine-color-default-border)",
                  overflow: "hidden",
                  boxShadow: pointed ? POINTED_RING : undefined,
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
  // Grid slots ring themselves; a count-only shelf's cells are the only
  // thing to ring.
  const pointed = compact && actions.pointAt.binId === bin.id;
  return (
    <div
      className={HOVER_PARENT}
      data-pointed={pointed || undefined}
      style={{
        position: "relative",
        width: "100%",
        minWidth: 0,
        borderRadius: 4,
        boxShadow: pointed ? POINTED_RING : undefined,
      }}
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
