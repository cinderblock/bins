/**
 * The right-hand pane of the desk-mode browse layout: everything about the
 * selected box, without leaving the list.
 *
 * The job this serves is checking, not capturing — working down a shelf
 * asking "is this labelled right, is this categorised, what's actually in
 * it". Navigating into a box page and back for each one loses your place in
 * the list and your scroll position; keeping the list alive next to a big
 * photo is the whole point.
 *
 * Read-only on purpose. Editing lives on the full box page, one click away,
 * so there is no second copy of the edit logic to drift.
 */
import {
  Anchor,
  Badge,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { hasContent } from "@shared/reducer";
import { IconMapPin } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import { PhotoImg } from "~/components/PhotoImg";
import { db } from "~/lib/db";
import { relativeTime } from "~/lib/format";
import { formatWeight } from "~/lib/labels";

export function BinDetailPane({ binId }: { binId: number | null }) {
  const bin = useLiveQuery(
    async () => (binId == null ? null : ((await db.bins.get(binId)) ?? null)),
    [binId],
    null,
  );
  const entries = useLiveQuery(
    async () =>
      binId == null
        ? []
        : (await db.entries.where("binId").equals(binId).toArray())
            // hasContent skips remove/restore stubs awaiting their entry.add.
            .filter((e) => !e.deletedByOpId && hasContent(e))
            .sort((a, b) => b.effectiveTime - a.effectiveTime),
    [binId],
    [],
  );
  const labels = useLiveQuery(async () => db.labels.toArray(), [], []);

  if (binId == null || !bin) {
    return (
      <Paper p="xl" radius="lg" withBorder h="100%">
        <Text c="dimmed" ta="center">
          Pick a box to see its photos and notes. ↑ and ↓ move through the list.
        </Text>
      </Paper>
    );
  }

  const photos = entries.filter((e) => e.photoHash);
  const notes = entries.filter((e) => e.text);
  const binLabels = labels.filter((l) => bin.labelIds?.includes(l.id));

  return (
    <Paper p="md" radius="lg" withBorder h="100%">
      <Stack gap="sm" h="100%">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Title order={3} lineClamp={2}>
              {bin.name || `Box #${bin.id}`}
            </Title>
            <Text size="sm" c="dimmed">
              #{bin.id}
              {bin.sizeClass ? ` · ${bin.sizeClass}` : ""}
              {bin.weightGrams ? ` · ${formatWeight(bin.weightGrams)}` : ""}
            </Text>
          </div>
          <Anchor component={Link} to={`/${bin.id}`} size="sm">
            Open
          </Anchor>
        </Group>

        {bin.locationName && (
          <Group gap={4} c="dimmed">
            <IconMapPin size={16} />
            <Text size="sm">{bin.locationName}</Text>
          </Group>
        )}

        {binLabels.length > 0 && (
          <Group gap={6}>
            {binLabels.map((l) => (
              <Badge key={l.id} color={l.color ?? "gray"} variant="light">
                {l.name}
              </Badge>
            ))}
          </Group>
        )}

        <ScrollArea style={{ flex: 1 }} type="auto">
          <Stack gap="sm">
            {photos.length === 0 && notes.length === 0 && (
              <Text c="dimmed" size="sm">
                Nothing captured for this box yet.
              </Text>
            )}
            {/* Big enough to actually verify contents — the whole reason this
                pane exists rather than a bigger list thumbnail. */}
            {photos.map((e) => (
              <PhotoImg
                key={e.id}
                hash={e.photoHash as string}
                thumbHash={e.thumbHash}
                alt=""
                style={{
                  width: "100%",
                  borderRadius: 8,
                  display: "block",
                }}
              />
            ))}
            {notes.map((e) => (
              <Paper key={e.id} p="xs" radius="md" withBorder>
                <Text size="sm">{e.text}</Text>
                <Text size="xs" c="dimmed">
                  {relativeTime(e.effectiveTime)}
                </Text>
              </Paper>
            ))}
          </Stack>
        </ScrollArea>
      </Stack>
    </Paper>
  );
}
