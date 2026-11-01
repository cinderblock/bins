/**
 * Would a report get handled right now, and how far along is the one in
 * progress? Shown wherever someone is deciding whether to report something.
 *
 * The percentage is a guess from past run times, and a bar that looks exact
 * would be claiming otherwise, so the text says "estimate".
 */
import { Group, Progress, Stack, Text } from "@mantine/core";
import { useSyncExternalStore } from "react";
import { type AgentStatus, agentSummary } from "~/lib/reportStep";
import { agentSnapshot, subscribeAgent } from "~/lib/reports";

export function useAgentStatus(): AgentStatus | null {
  return useSyncExternalStore(subscribeAgent, agentSnapshot, () => null);
}

export function agentIsBusy(agent: AgentStatus | null): boolean {
  return !!agent?.online && !!agent.stage && agent.stage !== "idle";
}

/** Green online, blue mid-fix, grey offline or not known yet. */
export function agentColor(agent: AgentStatus | null): string {
  if (agentIsBusy(agent)) return "var(--mantine-color-blue-5)";
  return agent?.online
    ? "var(--mantine-color-green-6)"
    : "var(--mantine-color-gray-6)";
}

export function AgentDot({ agent }: { agent: AgentStatus | null }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        flex: "none",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: agentColor(agent),
      }}
    />
  );
}

export function AgentStatusLine() {
  const agent = useAgentStatus();
  return (
    <Stack gap={4}>
      <Group gap={6} wrap="nowrap">
        <AgentDot agent={agent} />
        <Text size="xs" c="dimmed">
          {agentSummary(agent)}
        </Text>
      </Group>
      {agentIsBusy(agent) && agent?.progress != null && (
        <Progress
          value={agent.progress * 100}
          size="xs"
          aria-label="Estimated progress"
        />
      )}
    </Stack>
  );
}
