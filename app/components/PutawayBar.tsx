/**
 * The put-away control strip: which shelf boxes are being filed onto, and
 * the fastest ways to change it.
 *
 * Sits over the viewfinder because it belongs to the act of scanning. The
 * shelf STICKS — the job is a trolley of boxes going onto one shelf, so
 * asking per box would be a prompt every time. It changes by scanning that
 * shelf's own sticker or by tapping a recent one.
 */
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { locationLabel } from "@shared/locations";
import type { LocationState } from "@shared/reducer";
import { IconQrcode, IconX } from "@tabler/icons-react";
import type { PlaceMap } from "~/lib/places";

export function PutawayBar({
  place,
  byId,
  recent,
  filed,
  onPick,
  onClear,
}: {
  /** The shelf boxes are going onto, or null while none is chosen. */
  place: LocationState | null;
  byId: PlaceMap;
  /** Recently used shelves, most recent first, already resolved and filtered. */
  recent: LocationState[];
  /** How many boxes this session has filed onto the current shelf. */
  filed: number;
  onPick: (placeId: string) => void;
  onClear: () => void;
}) {
  return (
    <Paper p="sm" radius="md" withBorder>
      <Stack gap="xs">
        {place ? (
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <div style={{ minWidth: 0 }}>
              <Text size="xs" c="dimmed">
                Filing boxes onto
              </Text>
              <Text fw={700} truncate>
                {locationLabel(byId, place.id) || place.name}
              </Text>
            </div>
            <Group gap="xs" wrap="nowrap">
              {filed > 0 && (
                <Badge color="green" variant="light">
                  {filed} put away
                </Badge>
              )}
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                leftSection={<IconX size={14} />}
                onClick={onClear}
              >
                Change
              </Button>
            </Group>
          </Group>
        ) : (
          <Group gap="xs" wrap="nowrap">
            <IconQrcode size={18} />
            <Text size="sm">
              Scan a shelf's sticker, or pick one below. Every box scanned after
              that goes there.
            </Text>
          </Group>
        )}

        {recent.length > 0 && (
          <div>
            <Text size="xs" c="dimmed" mb={4}>
              Recent shelves
            </Text>
            <Group gap={6}>
              {recent.map((r) => (
                <Button
                  key={r.id}
                  size="compact-md"
                  variant={r.id === place?.id ? "filled" : "default"}
                  onClick={() => onPick(r.id)}
                >
                  {r.name}
                </Button>
              ))}
            </Group>
          </div>
        )}
      </Stack>
    </Paper>
  );
}
