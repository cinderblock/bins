/**
 * Everything people have reported, and what became of it. The place to dismiss
 * a report or send one back to the agent.
 */
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "~/lib/api";
import { relativeTime, shortBuild } from "~/lib/format";
import { AgentStatusLine } from "./AgentStatusLine";

type ReportRow = {
  id: string;
  reporterName: string;
  trust: string;
  text: string;
  route: string | null;
  status: string;
  resolution: string | null;
  fixedInBuild: string | null;
  createdAt: number;
};

const STATUS_COLOR: Record<string, string> = {
  open: "gray",
  working: "blue",
  fixed: "green",
  declined: "yellow",
  needs_human: "orange",
};

export function ReportLog({ adminPassword }: { adminPassword: string }) {
  const [reports, setReports] = useState<ReportRow[]>([]);

  const refresh = useCallback(async () => {
    const res = await apiJson<{ reports: ReportRow[] }>("/api/admin/reports", {
      method: "POST",
      body: JSON.stringify({ adminPassword }),
    });
    setReports(res.reports);
  }, [adminPassword]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  async function setStatus(reportId: string, status: "open" | "declined") {
    await apiJson("/api/admin/reports/update", {
      method: "POST",
      body: JSON.stringify({ adminPassword, reportId, status }),
    });
    await refresh();
  }

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="sm">
        <Text fw={600}>Reports</Text>
        <AgentStatusLine />
        {reports.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing reported yet.
          </Text>
        )}
        {reports.map((report) => (
          <Stack key={report.id} gap={4}>
            <Group gap="xs">
              <Badge size="xs" color={STATUS_COLOR[report.status] ?? "gray"}>
                {report.status.replace("_", " ")}
              </Badge>
              {report.trust === "admin" && (
                <Badge size="xs" variant="outline">
                  admin
                </Badge>
              )}
              <Text size="xs" c="dimmed">
                {report.reporterName} · {relativeTime(report.createdAt)}
                {report.route ? ` · ${report.route}` : ""}
                {report.fixedInBuild
                  ? ` · ${shortBuild(report.fixedInBuild)}`
                  : ""}
              </Text>
            </Group>
            <Text size="sm">{report.text}</Text>
            {report.resolution && (
              <Text size="xs" c="dimmed">
                {report.resolution}
              </Text>
            )}
            <Group gap="xs">
              {report.status !== "open" && report.status !== "working" && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => void setStatus(report.id, "open")}
                >
                  Send back to the agent
                </Button>
              )}
              {report.status === "open" && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => void setStatus(report.id, "declined")}
                >
                  Dismiss
                </Button>
              )}
            </Group>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
