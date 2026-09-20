/**
 * "Where is this box" bottom sheet.
 *
 * Two ways to answer. Structured: walk the configured places (bay → shelf),
 * and on a shelf with a grid tap the slot — the grid shows what is already in
 * each one, so putting a box down is a glance, not a guess. Freeform: type a
 * place that has no row ("Sam's truck"), which costs nothing and must keep
 * working (plans/multi-instance.md).
 *
 * Writes a whole location every time (place + slot, or a name) — see
 * setBinLocation. A box is only ever in one place.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { locationLabel } from "@shared/locations";
import type { BinState, LocationState } from "@shared/reducer";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { setBinLocation } from "~/lib/actions";
import { boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import {
  childrenOf,
  hasChildren,
  isGrid,
  placeSlots,
  useOccupancy,
  usePlaceMap,
} from "~/lib/places";

export function LocationSheet({
  bin,
  opened,
  onClose,
}: {
  bin: Pick<BinState, "id" | "locationName" | "locationId" | "slot">;
  opened: boolean;
  onClose: () => void;
}) {
  const byId = usePlaceMap();
  const occupancy = useOccupancy();
  const numbersInternal = useBoxNumbersInternal();
  const [freeform, setFreeform] = useState("");
  // Where in the hierarchy the sheet is looking. Opens on the box's current
  // place's parent, so moving one slot over is one tap, not four.
  const [at, setAt] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed only on open
  useEffect(() => {
    if (!opened) return;
    const current = bin.locationId ? byId.get(bin.locationId) : undefined;
    setAt(current?.parentId ?? null);
    setFreeform("");
  }, [opened]);

  async function place(
    target:
      | { locationId: string; slot: string | null; label: string }
      | { name: string | null },
  ) {
    if ("locationId" in target) {
      await setBinLocation(bin.id, {
        locationId: target.locationId,
        slot: target.slot,
      });
      notifications.show({
        message: `Location: ${target.label}`,
        color: "green",
      });
    } else {
      await setBinLocation(bin.id, target.name);
      notifications.show({
        message: target.name ? `Location: ${target.name}` : "Location cleared",
        color: "green",
      });
    }
    onClose();
  }

  const here = at ? byId.get(at) : undefined;
  const children = childrenOf(byId, at);
  const hasCurrent = Boolean(bin.locationId || bin.locationName);

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title="Where is this box?"
    >
      <Stack gap="xs" pb="env(safe-area-inset-bottom)">
        {here && (
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="default"
              size="lg"
              radius="xl"
              onClick={() => setAt(here.parentId)}
              aria-label="Up one level"
            >
              <IconChevronLeft size={18} />
            </ActionIcon>
            <Text fw={600} truncate>
              {locationLabel(byId, here.id)}
            </Text>
          </Group>
        )}

        {/* The place being looked at can itself be the answer — a room, a
            trailer, a bay with no particular shelf. */}
        {here && (
          <PlaceRow
            place={here}
            bin={bin}
            occupancy={occupancy.get(here.id)?.all.length ?? 0}
            numbersInternal={numbersInternal}
            byId={byId}
            occupants={occupancy}
            label={`Here (${here.name}, no particular slot)`}
            onPick={(target) => void place(target)}
            onDrill={null}
          />
        )}

        {children.map((child) => (
          <PlaceRow
            key={child.id}
            place={child}
            bin={bin}
            occupancy={occupancy.get(child.id)?.all.length ?? 0}
            numbersInternal={numbersInternal}
            byId={byId}
            occupants={occupancy}
            onPick={(target) => void place(target)}
            onDrill={hasChildren(byId, child.id) ? () => setAt(child.id) : null}
          />
        ))}

        {children.length === 0 && !here && (
          <Text size="sm" c="dimmed">
            No places set up yet — an admin adds shelves under Admin › Places.
          </Text>
        )}

        <Group gap="xs" mt="xs">
          <TextInput
            placeholder="somewhere else…"
            value={freeform}
            onChange={(e) => setFreeform(e.currentTarget.value)}
            size="lg"
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeform.trim())
                void place({ name: freeform.trim() });
            }}
          />
          <Button
            size="lg"
            variant="default"
            disabled={!freeform.trim()}
            onClick={() => void place({ name: freeform.trim() })}
          >
            Set
          </Button>
        </Group>
        {hasCurrent && (
          <Button
            size="sm"
            variant="subtle"
            color="gray"
            onClick={() => void place({ name: null })}
          >
            Clear location
          </Button>
        )}
      </Stack>
    </ResponsiveSheet>
  );
}

/**
 * One place in the list. A shelf with a grid unfolds into its slots; a plain
 * place is a single button; a place with children drills in.
 */
function PlaceRow({
  place,
  bin,
  occupancy,
  numbersInternal,
  byId,
  occupants,
  label,
  onPick,
  onDrill,
}: {
  place: LocationState;
  bin: Pick<BinState, "id" | "locationId" | "slot">;
  occupancy: number;
  numbersInternal: boolean;
  byId: ReadonlyMap<string, LocationState>;
  occupants: ReturnType<typeof useOccupancy>;
  label?: string;
  onPick: (target: {
    locationId: string;
    slot: string | null;
    label: string;
  }) => void;
  onDrill: (() => void) | null;
}) {
  const current = bin.locationId === place.id;
  const grid = isGrid(place);
  const slots = grid ? placeSlots(place) : [];
  const bySlot = occupants.get(place.id)?.bySlot;
  void byId;

  if (grid && !label) {
    return (
      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="sm" fw={600}>
            {place.name}
          </Text>
          <Badge
            size="sm"
            variant="light"
            color={occupancy > slots.length ? "red" : "gray"}
          >
            {occupancy}/{slots.length}
          </Badge>
        </Group>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${place.cols}, 1fr)`,
            gap: 4,
          }}
        >
          {slots.map((slot) => {
            const there = (bySlot?.get(slot) ?? []).filter(
              (b) => b.id !== bin.id,
            );
            const mine = current && bin.slot === slot;
            return (
              <UnstyledButton
                key={slot}
                onClick={() =>
                  onPick({
                    locationId: place.id,
                    slot,
                    label: `${place.name} · slot ${slot}`,
                  })
                }
                aria-label={`${place.name} slot ${slot}${
                  there.length ? `, holds ${there.length}` : ", empty"
                }`}
                style={{
                  minHeight: 48,
                  padding: 4,
                  borderRadius: 6,
                  border: `2px solid ${
                    mine
                      ? "var(--mantine-primary-color-filled)"
                      : "var(--mantine-color-default-border)"
                  }`,
                  background: there.length
                    ? "var(--mantine-color-default-hover)"
                    : "transparent",
                  fontSize: 12,
                  lineHeight: 1.2,
                  textAlign: "center",
                  overflow: "hidden",
                }}
              >
                <div style={{ opacity: 0.6 }}>{slot}</div>
                {there.slice(0, 2).map((b) => (
                  <div
                    key={b.id}
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {boxTitle(b, numbersInternal)}
                  </div>
                ))}
                {there.length > 2 && (
                  <div style={{ opacity: 0.6 }}>+{there.length - 2}</div>
                )}
                {mine && <div style={{ fontWeight: 600 }}>this box</div>}
              </UnstyledButton>
            );
          })}
        </div>
      </Stack>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <Button
        size="lg"
        variant={current && !bin.slot ? "filled" : "light"}
        style={{ flex: 1 }}
        onClick={() =>
          onPick({ locationId: place.id, slot: null, label: place.name })
        }
        rightSection={
          occupancy > 0 ? (
            <Badge size="sm" variant="light" color="gray">
              {occupancy}
            </Badge>
          ) : undefined
        }
      >
        {label ?? place.name}
      </Button>
      {onDrill && (
        <ActionIcon
          variant="default"
          size={50}
          radius="md"
          onClick={onDrill}
          aria-label={`Open ${place.name}`}
        >
          <IconChevronRight size={20} />
        </ActionIcon>
      )}
    </Group>
  );
}
