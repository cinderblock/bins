/**
 * What a poll of "/api/reports/mine" means for this device. Kept apart from
 * lib/reports so it can be tested without a browser.
 */
/** What the fixing agent is up to, as of the last poll. */
export type AgentStatus = {
  online: boolean;
  stage: string | null;
  reportId: string | null;
  /** 0 to 1, estimated. */
  progress: number | null;
  etaSeconds: number | null;
  /** Reports open or in progress across the whole group. */
  queued: number;
};

const STAGE_TEXT: Record<string, string> = {
  fixing: "Fixing",
  checking: "Running checks",
  reviewing: "Reviewing the change",
  publishing: "Building",
  deploying: "Deploying",
};

/** One short line: would a report get handled, and is one being handled now? */
export function agentSummary(agent: AgentStatus | null): string {
  if (!agent) return "Checking for the agent…";
  if (!agent.online) {
    return agent.queued > 0
      ? `Agent offline. ${agent.queued} waiting for it.`
      : "Agent offline. Reports wait until it's back.";
  }
  const label = agent.stage ? STAGE_TEXT[agent.stage] : undefined;
  if (!label) return "Agent online. Reports get picked up right away.";
  const eta = agent.etaSeconds;
  if (eta === null) return `${label}…`;
  return eta < 60
    ? `${label}, under a minute left (estimate)`
    : `${label}, about ${Math.round(eta / 60)} min left (estimate)`;
}

export type ServerReport = {
  id: string;
  text: string;
  status: string;
  resolution: string | null;
  fixedInBuild: string | null;
};

/** Report id → the last status this device told its user about. */
export type Tracked = Record<string, string>;

export type ReportStep = {
  tracked: Tracked;
  /** Things to tell the person, in order. */
  say: { message: string; color: string }[];
  /** The server has the fix and this device doesn't. */
  needsUpdate: boolean;
};

/**
 * What a poll means. A fix is only announced once THIS device is running what
 * the server runs: "fixed" while the page still has the bug would be a lie, so
 * until then all that happens is an update check.
 */
export function reportStep(
  tracked: Tracked,
  reports: ServerReport[],
  deviceBuild: string,
  serverBuild: string,
): ReportStep {
  const next: Tracked = { ...tracked };
  const say: ReportStep["say"] = [];
  let needsUpdate = false;

  for (const id of Object.keys(tracked)) {
    const report = reports.find((r) => r.id === id);
    // Aged out of the server's list, so nothing more will ever come of it.
    if (!report) {
      delete next[id];
      continue;
    }
    const known = tracked[id];
    const brief = report.resolution ?? report.text;
    if (report.status === "working" && known !== "working") {
      next[id] = "working";
      say.push({
        message: `Working on your report: ${report.text}`,
        color: "blue",
      });
    } else if (report.status === "fixed") {
      if (deviceBuild === serverBuild) {
        delete next[id];
        say.push({ message: `Fixed: ${brief}`, color: "green" });
      } else {
        needsUpdate = true;
      }
    } else if (
      report.status === "declined" ||
      report.status === "needs_human"
    ) {
      delete next[id];
      say.push({
        message: `Not fixed automatically: ${brief}`,
        color: "yellow",
      });
    }
  }
  return { tracked: next, say, needsUpdate };
}
