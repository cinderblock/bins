/**
 * What has actually gone wrong in people's browsers.
 *
 * The reason this exists: a user hit a real error and the only record of it
 * was them typing "Ran out of photo space" into a box's notes. Errors that
 * nobody records are errors nobody fixes — and this app's worst bugs were all
 * silent, reported second-hand as "it doesn't work".
 *
 * Grouped by problem with a count and the build it happened on, because "which
 * build" is the first question worth asking and "how many people" is the
 * second.
 */
import { Badge, Button, Code, Group, Paper, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "~/lib/api";
import { relativeTime, shortBuild } from "~/lib/format";

type ErrorRow = {
  id: string;
  kind: string;
  message: string;
  stack: string | null;
  route: string | null;
  buildSha: string | null;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

const KIND_COLOR: Record<string, string> = {
  render: "red",
  chunk: "orange",
  unhandled: "red",
  rejection: "yellow",
  capture: "grape",
  sync: "blue",
};

export function ErrorLog({ adminPassword }: { adminPassword: string }) {
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await apiJson<{ errors: ErrorRow[] }>("/api/admin/errors", {
      method: "POST",
      body: JSON.stringify({ adminPassword }),
    });
    setErrors(res.errors);
  }, [adminPassword]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  async function clear() {
    setBusy(true);
    try {
      await apiJson("/api/admin/errors/clear", {
        method: "POST",
        body: JSON.stringify({ adminPassword }),
      });
      await refresh();
    } catch (err) {
      notifications.show({ message: `Could not clear: ${err}`, color: "red" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Errors on people's devices</Text>
          {errors.length > 0 && (
            <Button
              size="compact-sm"
              variant="subtle"
              onClick={() => void clear()}
              loading={busy}
            >
              Clear all
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          Reported automatically, including from devices that were offline at
          the time. Grouped by problem — the count is how many times it has
          happened.
        </Text>

        {errors.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing reported. That is the good outcome.
          </Text>
        )}

        {errors.map((e) => (
          <Paper key={e.id} p="xs" radius="md" withBorder>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <div style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Badge size="sm" color={KIND_COLOR[e.kind] ?? "gray"}>
                    {e.kind}
                  </Badge>
                  {e.count > 1 && (
                    <Badge size="sm" variant="light">
                      ×{e.count}
                    </Badge>
                  )}
                  {e.buildSha && (
                    <Text size="xs" c="dimmed">
                      {shortBuild(e.buildSha)}
                    </Text>
                  )}
                </Group>
                <Text size="sm" style={{ wordBreak: "break-word" }}>
                  {e.message}
                </Text>
                <Text size="xs" c="dimmed">
                  {e.route ?? "—"} · last {relativeTime(e.lastSeenAt)}
                </Text>
              </div>
              {e.stack && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                >
                  {expanded === e.id ? "Hide" : "Stack"}
                </Button>
              )}
            </Group>
            {expanded === e.id && e.stack && (
              <Code
                block
                mt="xs"
                style={{ fontSize: 11, whiteSpace: "pre-wrap" }}
              >
                {e.stack}
              </Code>
            )}
          </Paper>
        ))}
      </Stack>
    </Paper>
  );
}
