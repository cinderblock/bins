/**
 * The assistant's answer, as a sheet over the box list.
 *
 * Deliberately a layer ON TOP of the list rather than a replacement for it:
 * this is the one surface that needs the network, and dismissing it puts you
 * straight back on a search that works everywhere. Every box it names is a
 * real link — the point is to walk to the box, not to read a paragraph.
 */
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { IconBoxOff, IconMapPin, IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAdminPassword } from "~/lib/admin";
import { type AskAnswer, type AskKind, ask, askErrorMessage } from "~/lib/ai";
import { boxPath, boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import { ResponsiveSheet } from "./ResponsiveSheet";

const CONFIDENCE_COLOR = {
  high: "teal",
  medium: "yellow",
  low: "gray",
} as const;

export function AskAiSheet({
  opened,
  onClose,
  kind,
  query,
}: {
  opened: boolean;
  onClose: () => void;
  kind: AskKind;
  query: string;
}) {
  const internal = useBoxNumbersInternal();
  const adminPassword = useAdminPassword();
  const [asking, setAsking] = useState<AskKind>(kind);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-opening always starts from whatever the caller asked for; a previous
  // disambiguation must not stick to the next question.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opened is the trigger, not a value read here.
  useEffect(() => setAsking(kind), [opened, kind]);

  useEffect(() => {
    if (!opened || !query.trim()) return;
    let live = true;
    setLoading(true);
    setError(null);
    setAnswer(null);
    ask(asking, query, adminPassword)
      .then((result) => {
        if (live) setAnswer(result);
      })
      .catch((err) => {
        if (live) setError(askErrorMessage(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [opened, asking, query, adminPassword]);

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconSparkles size={18} />
          <span>
            {asking === "place"
              ? "Where should it go?"
              : asking === "find"
                ? "Where is it?"
                : "Asking…"}
          </span>
        </Group>
      }
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          “{query}”
        </Text>

        {loading && (
          <Group gap="sm" justify="center" py="lg">
            <Loader size="sm" />
            <Text c="dimmed">Reading the whole inventory…</Text>
          </Group>
        )}

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        {answer?.ambiguous && (
          <Stack gap="sm">
            <Text>
              Could go either way — are you looking for this, or putting it
              away?
            </Text>
            <Group gap="xs">
              <Button variant="light" onClick={() => setAsking("find")}>
                I'm looking for it
              </Button>
              <Button variant="light" onClick={() => setAsking("place")}>
                I'm putting it away
              </Button>
            </Group>
          </Stack>
        )}

        {answer && !answer.ambiguous && (
          <>
            <Text>{answer.answer}</Text>

            {answer.meta?.fitProbability !== null &&
              answer.meta?.fitProbability !== undefined &&
              answer.meta.fitProbability > 0.35 &&
              answer.meta.fitProbability < 0.65 && (
                <Text size="sm" c="dimmed">
                  This one is genuinely borderline — an existing box might do.
                </Text>
              )}

            {answer.newBox && (
              <Alert
                color="blue"
                variant="light"
                icon={<IconBoxOff size={18} />}
                title="Start a new box"
              >
                <Stack gap="xs">
                  {answer.newBoxReason && <Text>{answer.newBoxReason}</Text>}
                  <Button
                    component={Link}
                    to="/new"
                    size="sm"
                    variant="light"
                    style={{ alignSelf: "flex-start" }}
                  >
                    Claim a new box
                  </Button>
                </Stack>
              </Alert>
            )}

            {answer.suggestedPlace && (
              <Group gap="xs" wrap="nowrap">
                <IconMapPin size={16} />
                <Text size="sm">Put it at {answer.suggestedPlace}</Text>
              </Group>
            )}

            {answer.boxes.map((box) => (
              <Card
                key={box.id}
                component={Link}
                to={boxPath({ id: box.id, handle: box.handle }, internal)}
                withBorder
                padding="sm"
                radius="md"
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Stack gap={4} style={{ minWidth: 0 }}>
                    <Text fw={600}>
                      {boxTitle(
                        { id: box.id, handle: box.handle, name: box.name },
                        internal,
                      )}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {box.reason}
                    </Text>
                    {box.fillLevel !== null && (
                      <Text size="xs" c="dimmed">
                        {box.fillLevel}% full
                      </Text>
                    )}
                    {box.location && (
                      <Group gap={4} wrap="nowrap">
                        <IconMapPin size={14} />
                        <Text size="xs" c="dimmed">
                          {box.location}
                        </Text>
                      </Group>
                    )}
                  </Stack>
                  <Badge
                    size="sm"
                    variant="light"
                    color={CONFIDENCE_COLOR[box.confidence]}
                  >
                    {box.confidence}
                  </Badge>
                </Group>
              </Card>
            ))}

            {answer.boxes.length === 0 && !answer.newBox && (
              <Text c="dimmed">
                No box in the inventory looks like a match. The search below may
                still turn something up.
              </Text>
            )}

            {/* Visible rather than hidden behind a hover: someone is paying
                per question, and the per-answer cost is the only way to
                notice it drifting. */}
            <Text size="xs" c="dimmed">
              {answer.meta.model} · {answer.meta.bins} boxes · $
              {answer.meta.costUsd.toFixed(4)}
              {answer.meta.cachedInputTokens > 0 && " · cached"}
            </Text>
          </>
        )}
      </Stack>
    </ResponsiveSheet>
  );
}
