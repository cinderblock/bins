/**
 * "Which shelf is this sticker on?"
 *
 * The shelf stickers were printed before any of this existed and carry a
 * bare random string, so the app learns what they mean the only way it can:
 * someone stands at the shelf, scans the sticker, and says which shelf it
 * is. Done once per shelf, at the moment the camera is already pointed at
 * it — which is why this lives in put-away rather than in a settings screen
 * where the sticker isn't in front of you.
 */
import { Alert, Button, Code, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { locationLabel } from "@shared/locations";
import type { LocationState } from "@shared/reducer";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { upsertLocation } from "~/lib/actions";
import { placeCodeKey } from "~/lib/format";
import { type PlaceMap, codeOwners } from "~/lib/places";

export function BindStickerSheet({
  code,
  byId,
  onClose,
  onBound,
}: {
  /** The unrecognised sticker string, or null when the sheet is shut. */
  code: string | null;
  byId: PlaceMap;
  onClose: () => void;
  onBound: (placeId: string) => void;
}) {
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const places = [...byId.values()]
    .filter((p) => !p.archived)
    .sort((a, b) =>
      locationLabel(byId, a.id).localeCompare(
        locationLabel(byId, b.id),
        undefined,
        { numeric: true },
      ),
    );

  // Already on another shelf? Say so before it is moved, not after. Codes
  // are not unique in the data model (the reducer can't check without
  // becoming order-dependent), so this warning is the only guard there is.
  const taken = code ? (codeOwners(byId).get(placeCodeKey(code)) ?? []) : [];
  const chosen = placeId ? byId.get(placeId) : undefined;

  async function bind(place: LocationState) {
    if (!code) return;
    setBusy(true);
    try {
      await upsertLocation(place.id, place.name, place.sortOrder, {
        parentId: place.parentId,
        cols: place.cols,
        rows: place.rows,
        span: place.span,
        code,
      });
      notifications.show({
        message: `That sticker now means ${place.name}`,
        color: "green",
      });
      onBound(place.id);
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet
      opened={code !== null}
      onClose={onClose}
      title="Unknown shelf sticker"
      dismissLabel="Not now"
    >
      <Stack gap="sm">
        <Text size="sm">This sticker isn't on any shelf yet:</Text>
        <Code block>{code}</Code>
        <Text size="sm" c="dimmed">
          Say which shelf it's stuck to and every future scan of it files boxes
          there.
        </Text>
        {taken.length > 0 && (
          <Alert
            color="orange"
            variant="light"
            icon={<IconAlertTriangle size={16} />}
          >
            <Text size="sm">
              {taken.length === 1
                ? `Careful: ${taken[0]?.name} already claims this exact sticker. Two shelves with one sticker is ambiguous.`
                : `Careful: ${taken.length} shelves already claim this exact sticker.`}
            </Text>
          </Alert>
        )}
        <Select
          label="This is"
          placeholder="Pick the shelf"
          data={places.map((p) => ({
            value: p.id,
            label: locationLabel(byId, p.id) || p.name,
          }))}
          value={placeId}
          onChange={setPlaceId}
          searchable
        />
        <Button
          size="md"
          disabled={!chosen}
          loading={busy}
          onClick={() => chosen && void bind(chosen)}
        >
          {chosen ? `This sticker is ${chosen.name}` : "Pick a shelf"}
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}
