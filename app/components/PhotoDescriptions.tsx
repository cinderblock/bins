/**
 * The admin control for reading contents photos.
 *
 * The one surface in this app that shows a price before you press the button.
 * Describing photos is the only bulk action that spends money proportional to
 * how much stuff you have, so the backlog and the estimate come first and the
 * run is batched — an operator with nine hundred photos should find out what
 * that costs from this panel, not from a bill.
 */
import {
  Alert,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconEye, IconSparkles } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "~/lib/api";

type CaptionStatus = {
  available: boolean;
  pending: number;
  model: string | null;
  estimateUsd: number;
  automatic: boolean;
};

type CaptionRun = {
  described: number;
  fromCache: number;
  remaining: number;
  costUsd: number;
  stoppedBecause: string | null;
};

function money(usd: number): string {
  // Sub-cent totals are the normal case for a small batch, and rounding them
  // to "$0.00" reads as free when it isn't.
  return usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function PhotoDescriptions({
  adminPassword,
}: {
  adminPassword: string;
}) {
  const [status, setStatus] = useState<CaptionStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<CaptionRun | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(
        await apiJson<CaptionStatus>("/api/admin/ai/captions", {
          method: "POST",
          body: JSON.stringify({ adminPassword }),
        }),
      );
    } catch {
      // An older server, or no provider. Either way: show nothing.
      setStatus(null);
    }
  }, [adminPassword]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async () => {
    setRunning(true);
    try {
      const result = await apiJson<CaptionRun>("/api/admin/ai/captions/run", {
        method: "POST",
        body: JSON.stringify({ adminPassword }),
      });
      setDone(result);
      await refresh();
      notifications.show({
        message: result.described
          ? `Read ${result.described} photo${result.described === 1 ? "" : "s"} · ${money(result.costUsd)}`
          : "Nothing left to read",
      });
    } catch (err) {
      notifications.show({
        color: "red",
        message: err instanceof Error ? err.message : "Could not read photos",
      });
    } finally {
      setRunning(false);
    }
  };

  // Hidden entirely when no provider is configured — the same rule the rest
  // of the AI surface follows.
  if (!status?.available) return null;

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <IconSparkles size={18} />
          <Text fw={600}>Photo descriptions</Text>
        </Group>
        <Text size="xs" c="dimmed">
          Reads each box's contents photo and files the words next to it, so a
          box that was only ever photographed can still be found by typing
          what's in it. Runs in batches; the results sync to every device and
          work offline afterwards.
        </Text>

        {status.pending === 0 ? (
          <Text size="sm">Every photo has been read.</Text>
        ) : (
          <>
            <Group justify="space-between">
              <Text size="sm">
                {status.pending} photo{status.pending === 1 ? "" : "s"} not read
                yet
              </Text>
              <Text size="sm" c="dimmed">
                about {money(status.estimateUsd)} for all of them
              </Text>
            </Group>
            {done && done.remaining > 0 && (
              <Progress
                value={
                  (100 * (status.pending - done.remaining)) / status.pending
                }
              />
            )}
            <Button
              leftSection={<IconEye size={16} />}
              loading={running}
              onClick={run}
              style={{ alignSelf: "flex-start" }}
            >
              Read the next batch
            </Button>
          </>
        )}

        {done?.stoppedBecause && (
          <Alert color="yellow" variant="light">
            {done.stoppedBecause} Everything read before that is saved.
          </Alert>
        )}

        <Text size="xs" c="dimmed">
          Using {status.model}.{" "}
          {status.automatic
            ? "New photos are read automatically as they arrive."
            : "New photos are only read when you press this (set AI_CAPTION_PHOTOS to do it automatically)."}
        </Text>
      </Stack>
    </Paper>
  );
}
