/**
 * The bin page's "Deleted" drawer — the escape hatch for a delete whose Undo
 * toast is long gone, including one someone ELSE made on another device.
 *
 * Nothing is ever really thrown away: the op log is append-only, blobs are
 * content-addressed and never garbage-collected, and the entry row survives
 * with its tombstone set. All this section does is stop hiding those rows and
 * offer the entry.restore op that flips them back for the whole group. Kept
 * collapsed by default — it's a recovery tool, not part of the daily rhythm.
 */
import { Button, Collapse, Group, Paper, Stack, Text } from "@mantine/core";
import type { EntryState } from "@shared/reducer";
import {
  IconChevronDown,
  IconChevronRight,
  IconRestore,
} from "@tabler/icons-react";
import { useState } from "react";
import { restoreEntry } from "~/lib/actions";
import { relativeTime } from "~/lib/format";
import { PhotoImg } from "./PhotoImg";

export function DeletedEntries({
  entries,
  authors,
}: {
  /** Deleted entries for one bin, newest first. */
  entries: EntryState[];
  authors: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <Stack gap="xs" mt="xs">
      <Group>
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={
            open ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )
          }
          onClick={() => setOpen((o) => !o)}
        >
          {entries.length} deleted
        </Button>
      </Group>

      <Collapse in={open}>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Deleted photos and notes are kept, not erased. Restoring one brings
            it back on everyone's device.
          </Text>
          {entries.map((entry) => (
            <Paper key={entry.id} p="xs" radius="md" withBorder>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group wrap="nowrap" gap="sm" style={{ minWidth: 0 }}>
                  {entry.photoHash ? (
                    <PhotoImg
                      hash={entry.photoHash}
                      thumbHash={entry.thumbHash}
                      alt={
                        entry.kind === "contents_photo"
                          ? "deleted contents photo"
                          : "deleted item photo"
                      }
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        flexShrink: 0,
                        display: "block",
                        opacity: 0.65,
                      }}
                    />
                  ) : null}
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" c="dimmed" lineClamp={2}>
                      {entry.text ??
                        (entry.kind === "contents_photo"
                          ? "Contents photo"
                          : "Item photo")}
                    </Text>
                    {/* Who ADDED it, and when — the op log knows who deleted
                        it, but the replica only materializes the tombstone's
                        opId, so claiming an author here would be a guess. */}
                    <Text size="xs" c="dimmed">
                      {(entry.deviceId && authors[entry.deviceId]) ?? ""}{" "}
                      {relativeTime(entry.effectiveTime)}
                    </Text>
                  </div>
                </Group>
                <Button
                  size="compact-sm"
                  variant="light"
                  leftSection={<IconRestore size={14} />}
                  style={{ flexShrink: 0 }}
                  onClick={() => void restoreEntry(entry.binId, entry.id)}
                >
                  Restore
                </Button>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}
