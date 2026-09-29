/**
 * "It's over there": a small, read-only floor plan with one thing pulsing,
 * for the places that answer "where is this box" — the box page, the desk
 * detail pane, the scanner's peek, and put-away after a shelf scan.
 *
 * Renders nothing unless the thing is actually ON a map. An empty room with
 * no highlight is not an answer, and the surfaces this sits in are already
 * busy; the full map says "not on this map yet" for whoever goes looking.
 *
 * The whole thumbnail is one button into the full map, pointing at the same
 * thing — no pan or zoom to fight a page scroll with.
 */
import { Text, UnstyledButton, useComputedColorScheme } from "@mantine/core";
import { locationLabel } from "@shared/locations";
import type { BinState } from "@shared/reducer";
import { IconMapPin } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { FloorPlanSvg } from "~/components/FloorPlanSvg";
import { buildScene, mapTargetFor, usePlanData } from "~/lib/floorplan";
import { getLengthUnit } from "~/lib/lengths";

export function FloorPlanMini({
  bin,
  placeId,
  height = 150,
}: {
  /** Point at this box (its location decides where). */
  bin?: BinState | null;
  /** Or at this place directly — a scanned shelf. */
  placeId?: string | null;
  height?: number;
}) {
  const data = usePlanData();
  const scheme = useComputedColorScheme("dark");
  const navigate = useNavigate();
  const at = bin ? bin.locationId : (placeId ?? null);
  const target = mapTargetFor(data, at);
  const space = target?.item ? data.byId.get(target.space.id) : undefined;
  if (!target?.item || !space || !at) return null;

  const { scene } = buildScene(space, data);
  const href = bin
    ? `/shelves?place=${space.id}&find=${bin.id}`
    : `/shelves?place=${space.id}&at=${at}`;
  const where = [target.item.name, target.bay?.name]
    .filter(Boolean)
    .join(" › ");

  return (
    <UnstyledButton
      onClick={() => navigate(href)}
      aria-label={`Show ${locationLabel(data.byId, at)} on the floor plan of ${space.name}`}
      style={{ display: "block", width: "100%" }}
    >
      <FloorPlanSvg
        scene={scene}
        colorBy="none"
        scheme={scheme}
        highlight={{ itemId: target.item.id, bayId: target.bay?.id ?? null }}
        unit={getLengthUnit()}
        interactive={false}
        height={height}
        fitKey={space.id}
      />
      <Text
        size="xs"
        c="dimmed"
        mt={4}
        style={{ display: "flex", gap: 4, alignItems: "center" }}
      >
        <IconMapPin size={13} color="var(--mantine-color-yellow-5)" />
        {space.name} · {where} — tap for the full map
      </Text>
    </UnstyledButton>
  );
}
