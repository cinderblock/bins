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
  UnstyledButton,
} from "@mantine/core";
import { hasContent } from "@shared/reducer";
import { IconMapPin } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link } from "react-router";
import { PhotoImg } from "~/components/PhotoImg";
import { useBoxSizes } from "~/lib/boxSizes";
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
  const sizes = useBoxSizes();
  /**
   * Which photo fills the hero slot. Stored WITH its box so moving to another
   * box falls back to that box's newest photo automatically — derived rather
   * than reset in an effect, so there is no stale frame in between.
   */
  const [active, setActive] = useState<{ binId: number; id: string } | null>(
    null,
  );
  const activeId = active?.binId === binId ? active.id : null;

  if (binId == null || !bin) {
    return (
      <Paper p="xl" radius="lg" withBorder h="100%">
        <Text c="dimmed" ta="center">
          Pick a box to see its photos and notes. ↑ and ↓ move through the list.
        </Text>
      </Paper>
    );
  }

  // A defined size wins; legacy free text is the fallback for boxes not yet
  // migrated or set.
  const sizeLabel =
    sizes.find((s) => s.id === bin.sizeId)?.name ?? bin.sizeClass ?? null;

  const photos = entries.filter((e) => e.photoHash);
  const hero = photos.find((e) => e.id === activeId) ?? photos[0] ?? null;
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
              {sizeLabel ? ` · ${sizeLabel}` : ""}
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

        {photos.length === 0 && notes.length === 0 && (
          <Text c="dimmed" size="sm">
            Nothing captured for this box yet.
          </Text>
        )}

        {/* The hero FITS the pane — it never exceeds the space available, so
            verifying a box is a glance and not a scroll. Stacking photos at
            full width was worse than useless: one photo could be taller than
            the screen, and you had to scroll past it to learn anything. */}
        {hero && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PhotoImg
              key={hero.id}
              hash={hero.photoHash as string}
              // preferFull, or PhotoImg serves the 320px thumb — which looked
              // like mud once it filled the pane.
              preferFull
              alt=""
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: 8,
                display: "block",
              }}
            />
          </div>
        )}

        {/* Other photos stay one click away instead of one scroll away. */}
        {photos.length > 1 && (
          <Group gap="xs" wrap="nowrap" style={{ overflowX: "auto" }}>
            {photos.map((e) => (
              <UnstyledButton
                key={e.id}
                onClick={() => setActive({ binId, id: e.id })}
                aria-label="Show this photo"
                style={{ flexShrink: 0, lineHeight: 0 }}
              >
                <PhotoImg
                  hash={e.photoHash as string}
                  thumbHash={e.thumbHash}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: "cover",
                    borderRadius: 6,
                    display: "block",
                    outline:
                      e.id === hero?.id
                        ? "2px solid var(--mantine-color-blue-5)"
                        : "none",
                    opacity: e.id === hero?.id ? 1 : 0.65,
                  }}
                />
              </UnstyledButton>
            ))}
          </Group>
        )}

        {notes.length > 0 && (
          // Bounded so notes can never push the photo off-screen; scrolls
          // internally when there are a lot of them.
          <ScrollArea style={{ maxHeight: "22vh" }} type="auto">
            <Stack gap="xs">
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
        )}
      </Stack>
    </Paper>
  );
}
