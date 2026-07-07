/**
 * Bottom "peek" panel for auto-scan mode: the last-scanned bin's contents and
 * history floated over the live camera. Read-only by design — the capture
 * button lives next to it, and everything else (item photos, notes, location,
 * retire) belongs to the full bin page, one tap on the header away.
 */
import { ActionIcon, Badge, Group, Paper, Stack, Text } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconMapPin,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import { PhotoImg } from "~/components/PhotoImg";
import { db } from "~/lib/db";
import { relativeTime } from "~/lib/format";

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
        .filter((e) => !e.deletedByOpId)
        .sort((a, b) => b.effectiveTime - a.effectiveTime),
    [binId],
    [],
  );

  if (!bin) return null;
  const photos = entries.filter((e) => e.photoHash);
  const notes = entries.filter((e) => e.kind === "note");

  return (
    <Paper radius="lg" p="sm" style={{ maxHeight: "42dvh", overflowY: "auto" }}>
      <Group justify="space-between" wrap="nowrap">
        <Link
          to={`/${bin.id}`}
          style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}
          aria-label={`Open bin ${bin.id}`}
        >
          <Group gap={8} wrap="nowrap">
            <Text fw={700} size="lg">
              #{bin.id}
            </Text>
            {bin.name && (
              <Text size="lg" truncate>
                {bin.name}
              </Text>
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
        <Text size="sm" c={bin.locationName ? undefined : "dimmed"}>
          {bin.locationName ?? "no location set"} · updated{" "}
          {relativeTime(bin.updatedAt)}
        </Text>
      </Group>

      {photos.length > 0 && (
        <Group
          gap="xs"
          mb={notes.length > 0 ? "xs" : 0}
          style={{ overflowX: "auto", flexWrap: "nowrap" }}
        >
          {photos.map((entry) => (
            <PhotoImg
              key={entry.id}
              hash={entry.photoHash as string}
              thumbHash={entry.thumbHash}
              alt={entry.kind === "contents_photo" ? "contents" : "item"}
              style={{
                width: 72,
                height: 72,
                borderRadius: 8,
                flexShrink: 0,
                display: "block",
              }}
            />
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
              <Text size="xs" c="dimmed">
                {relativeTime(note.effectiveTime)}
              </Text>
            </Paper>
          ))}
        </Stack>
      )}

      {photos.length === 0 && notes.length === 0 && (
        <Text size="sm" c="dimmed">
          Nothing recorded yet — open the box and capture its contents.
        </Text>
      )}
    </Paper>
  );
}
