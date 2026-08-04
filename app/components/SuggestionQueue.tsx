/**
 * The admin review queue for member-suggested edits. Renders each proposal as
 * a before → after diff of only the fields it actually touches, so approving
 * is a glance rather than a comparison exercise.
 *
 * Reads from the SERVER rather than the replica: the "before" values must be
 * what the box looks like right now to whoever else is syncing, not what this
 * device last pulled — approving against a stale picture is exactly how an
 * admin rubber-stamps a change that's already been superseded.
 */
import {
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { relativeTime } from "~/lib/format";
import {
  fetchSuggestions,
  resolveSuggestion,
  SUGGEST_FIELDS,
  type SuggestionReview,
} from "~/lib/suggestions";
import { TOUCH_TARGET } from "~/lib/ui";

function Value({ children }: { children: string | null | undefined }) {
  if (children == null || children === "") {
    return (
      <Text span size="sm" c="dimmed" fs="italic">
        empty
      </Text>
    );
  }
  return (
    <Text span size="sm">
      {children}
    </Text>
  );
}

export function SuggestionQueue({
  adminPassword,
  authors,
}: {
  adminPassword: string;
  /** deviceId → display name, so a proposal has a face on it. */
  authors: Record<string, string>;
}) {
  const [rows, setRows] = useState<SuggestionReview[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await fetchSuggestions(adminPassword));
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    }
  }, [adminPassword]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function resolve(row: SuggestionReview, accepted: boolean) {
    setBusyId(row.id);
    try {
      await resolveSuggestion(adminPassword, row.id, accepted);
      notifications.show({
        message: accepted ? `Applied to #${row.binId}` : "Suggestion dismissed",
        color: accepted ? "green" : "gray",
      });
      await refresh();
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
      // A 409 means someone else decided it — reload rather than leave a
      // button that will keep failing.
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows?.filter((r) => r.status === "pending") ?? [];
  const decided = (rows?.filter((r) => r.status !== "pending") ?? [])
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
    .slice(0, 5);

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Suggested edits</Text>
          {pending.length > 0 && <Badge color="blue">{pending.length}</Badge>}
        </Group>
        <Text size="xs" c="dimmed">
          Members propose changes to a box's name, size, and external label;
          everything else they change themselves. Approving applies the change
          as a normal edit — if someone has since renamed the box, the newer
          name wins.
        </Text>

        {rows === null && (
          <Text size="sm" c="dimmed">
            Loading…
          </Text>
        )}
        {rows !== null && pending.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing waiting.
          </Text>
        )}

        {pending.map((row) => (
          <Paper key={row.id} p="sm" radius="md" withBorder>
            <Stack gap={6}>
              <Group justify="space-between" gap="xs">
                <Anchor
                  component={Link}
                  to={`/${row.binId}`}
                  size="sm"
                  fw={600}
                >
                  #{row.binId}
                  {row.current?.name ? ` ${row.current.name}` : ""}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {(row.deviceId && authors[row.deviceId]) || "someone"} ·{" "}
                  {relativeTime(row.createdAt)}
                </Text>
              </Group>

              {SUGGEST_FIELDS.map(({ key, label }) => {
                // An absent key means the suggestion doesn't touch this field.
                if (!(key in row.fields)) return null;
                return (
                  <Group key={key} gap={6} wrap="nowrap" align="baseline">
                    <Text size="xs" c="dimmed" w={92} style={{ flexShrink: 0 }}>
                      {label}
                    </Text>
                    <Value>{row.current?.[key]}</Value>
                    <Text span size="sm" c="dimmed">
                      →
                    </Text>
                    <Value>{row.fields[key]}</Value>
                  </Group>
                );
              })}

              {row.note && (
                <Text size="sm" c="dimmed">
                  “{row.note}”
                </Text>
              )}

              <Group grow gap="xs" mt={4}>
                <Button
                  h={TOUCH_TARGET}
                  leftSection={<IconCheck size={18} />}
                  loading={busyId === row.id}
                  onClick={() => void resolve(row, true)}
                >
                  Approve
                </Button>
                <Button
                  h={TOUCH_TARGET}
                  variant="default"
                  leftSection={<IconX size={18} />}
                  disabled={busyId === row.id}
                  onClick={() => void resolve(row, false)}
                >
                  Dismiss
                </Button>
              </Group>
            </Stack>
          </Paper>
        ))}

        {decided.length > 0 && (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" mt="xs">
              Recently decided
            </Text>
            {decided.map((row) => (
              <Group key={row.id} gap="xs" wrap="nowrap">
                <Badge
                  size="sm"
                  variant="light"
                  color={row.status === "accepted" ? "green" : "gray"}
                >
                  {row.status}
                </Badge>
                <Text size="xs" c="dimmed" truncate>
                  #{row.binId} · {row.fields.name ?? row.fields.sizeClass ?? ""}{" "}
                  {row.resolvedAt ? relativeTime(row.resolvedAt) : ""}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
