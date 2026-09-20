/**
 * Bottom "peek" panel for auto-scan mode: the last-scanned bin's contents and
 * history floated over the live camera. Mostly read-only — the capture button
 * lives next to it, and editing belongs to the full bin page, one tap on the
 * header away. The exception is deleting: a wrong photo or note spotted while
 * scanning down a shelf shouldn't cost a navigation. Photos open the shared
 * lightbox (delete inside); notes carry the shared two-tap delete, so a
 * stray tap over a live camera can't destroy anything.
 */
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { EntryState } from "@shared/reducer";
import { hasContent } from "@shared/reducer";
import {
  IconChevronDown,
  IconChevronRight,
  IconMapPin,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link } from "react-router";
import { DeleteEntryButton } from "~/components/DeleteEntryButton";
import { PhotoImg } from "~/components/PhotoImg";
import { PhotoLightbox } from "~/components/PhotoLightbox";
import { boxPath, boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import { db } from "~/lib/db";
import { relativeTime } from "~/lib/format";
import { describeBinLocation, usePlaceMap } from "~/lib/places";

export function BinPeek({
  binId,
  onCollapse,
}: {
  binId: number;
  onCollapse: () => void;
}) {
  const bin = useLiveQuery(
    async () => (await db.bins.get(binId)) ?? null,
    [binId],
    null,
  );
  const entries = useLiveQuery(
    async () =>
      (await db.entries.where("binId").equals(binId).toArray())
        // hasContent skips remove/restore stubs awaiting their entry.add.
        .filter((e) => !e.deletedByOpId && hasContent(e))
        .sort((a, b) => b.effectiveTime - a.effectiveTime),
    [binId],
    [],
  );

  const [lightbox, setLightbox] = useState<EntryState | null>(null);
  const numbersInternal = useBoxNumbersInternal();
  const placeById = usePlaceMap();

  if (!bin) return null;
  const where = describeBinLocation(bin, placeById);
  const photos = entries.filter((e) => e.photoHash);
  const notes = entries.filter((e) => e.kind === "note");

  return (
    <Paper radius="lg" p="sm" style={{ maxHeight: "42dvh", overflowY: "auto" }}>
      <Group justify="space-between" wrap="nowrap">
        <Link
          to={boxPath(bin, numbersInternal)}
          style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}
          aria-label={`Open ${boxTitle(bin, numbersInternal)}`}
        >
          <Group gap={8} wrap="nowrap">
            {numbersInternal ? (
              <Text fw={700} size="lg" truncate>
                {boxTitle(bin, true)}
              </Text>
            ) : (
              <>
                <Text fw={700} size="lg">
                  #{bin.id}
                </Text>
                {bin.name && (
                  <Text size="lg" truncate>
                    {bin.name}
                  </Text>
                )}
              </>
            )}
            {bin.status === "retired" && <Badge color="gray">retired</Badge>}
            <IconChevronRight
              size={16}
              style={{ opacity: 0.5, flexShrink: 0 }}
            />
          </Group>
        </Link>
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={onCollapse}
          aria-label="Collapse bin details"
        >
          <IconChevronDown />
        </ActionIcon>
      </Group>

      <Group gap={6} mb="xs">
        <IconMapPin size={14} style={{ opacity: 0.6 }} />
        <Text size="sm" c={where ? undefined : "dimmed"}>
          {where ?? "no location set"} · updated {relativeTime(bin.updatedAt)}
        </Text>
      </Group>

      {photos.length > 0 && (
        <Group
          gap="xs"
          mb={notes.length > 0 ? "xs" : 0}
          style={{ overflowX: "auto", flexWrap: "nowrap" }}
        >
          {photos.map((entry) => (
            <UnstyledButton
              key={entry.id}
              onClick={() => setLightbox(entry)}
              style={{ flexShrink: 0, lineHeight: 0 }}
              aria-label="Open photo"
            >
              <PhotoImg
                hash={entry.photoHash as string}
                thumbHash={entry.thumbHash}
                alt={entry.kind === "contents_photo" ? "contents" : "item"}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 8,
                  display: "block",
                }}
              />
            </UnstyledButton>
          ))}
        </Group>
      )}

      {notes.length > 0 && (
        <Stack gap={6}>
          {notes.map((note) => (
            <Paper key={note.id} p="xs" radius="md" withBorder>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {note.text}
              </Text>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {relativeTime(note.effectiveTime)}
                </Text>
                <DeleteEntryButton
                  binId={bin.id}
                  entryId={note.id}
                  what="Note"
                />
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {photos.length === 0 && notes.length === 0 && (
        <Text size="sm" c="dimmed">
          Nothing recorded yet — open the box and capture its contents.
        </Text>
      )}

      <PhotoLightbox
        photos={photos}
        entry={lightbox}
        onClose={() => setLightbox(null)}
      />
    </Paper>
  );
}
