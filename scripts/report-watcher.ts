/**
 * Turns reports into shipped fixes, with nobody at the keyboard.
 *
 *   bun scripts/report-watcher.ts            run until stopped
 *   bun scripts/report-watcher.ts --once     handle what's queued, then exit
 *   bun scripts/report-watcher.ts --no-ship  stop before pushing; for trying it
 *   bun scripts/report-watcher.ts --stop     stop a running watcher
 *
 * Configured by `.report-watcher.local` at the repo root (JSON, untracked):
 *
 *   {
 *     "deployments": [{ "name": "...", "origin": "https://...", "token": "bins_..." }],
 *     "deployCommand": ["gh", "workflow", "run", "..."],
 *     "denyStrings": ["names that must never reach this public repo"]
 *   }
 *
 * `token` is a write-scoped integration token from /admin. `deployCommand` is
 * whatever makes a published image go live sooner; leave it out and deployment
 * happens on whatever schedule it already has.
 *
 * The rules that make this safe to leave running live in report-watcher-lib.ts
 * and plans/report-and-autofix.md. In short: only the watcher commits and
 * pushes, a member's report only ever reaches an agent with no shell and no
 * network, and its diff is gated and independently reviewed before any of it is
 * executed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_SCHEMA,
  DEFAULT_TIMINGS,
  MEMBER_ALLOWED_TOOLS,
  REVIEW_SCHEMA,
  type Stage,
  type Timings,
  type WatchedReport,
  agentPrompt,
  denyListHits,
  estimate,
  memberDiffProblems,
  parseDiff,
  reviewPrompt,
  updateTiming,
} from "./report-watcher-lib";

type Deployment = { name: string; origin: string; token: string };
type Config = {
  deployments: Deployment[];
  deployCommand?: string[];
  denyStrings?: string[];
};

const REPO = resolve(import.meta.dir, "..");
const STATE_DIR = join(homedir(), ".bins-report-watcher");
const WORKTREE = join(STATE_DIR, "worktree");
const PID_FILE = join(STATE_DIR, "watcher.pid");
const TIMINGS_FILE = join(STATE_DIR, "timings.json");
const USAGE_FILE = join(STATE_DIR, "usage.json");

const POLL_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const AGENT_TIMEOUT_MS = 30 * 60_000;
const CHECK_TIMEOUT_MS = 10 * 60_000;
const DEPLOY_TIMEOUT_MS = 25 * 60_000;
/** Renovate only acts while running, so nudge it again if a run missed us. */
const REDEPLOY_NUDGE_MS = 4 * 60_000;
/** Member reports cost real money and are the abuse path, so they're capped. */
const MEMBER_FIXES_PER_DAY = 15;

const args = new Set(process.argv.slice(2));
const noShip = args.has("--no-ship");

const log = (message: string) =>
  console.log(`${new Date().toLocaleString()}  ${message}`);

async function run(
  command: string[],
  options: { cwd?: string; timeoutMs?: number; stdin?: string } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd ?? WORKTREE,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  if (options.stdin !== undefined && proc.stdin) {
    proc.stdin.write(options.stdin);
    proc.stdin.end();
  }
  const timer = setTimeout(() => proc.kill(), options.timeoutMs ?? 120_000);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { ok: code === 0, stdout, stderr };
}

async function must(command: string[], cwd?: string): Promise<string> {
  const result = await run(command, { cwd });
  if (!result.ok) {
    throw new Error(`${command.join(" ")}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function api(
  deployment: Deployment,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${deployment.origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${deployment.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

// --- Status, for the dot and the progress bar in the app ---------------------

let timings: Timings = { ...DEFAULT_TIMINGS };
let stage: Stage = "idle";
let stageStartedAt = Date.now();
let currentReportId: string | null = null;

function enterStage(next: Stage, reportId: string | null = currentReportId) {
  if (stage !== "idle") {
    const seconds = (Date.now() - stageStartedAt) / 1000;
    timings = updateTiming(timings, stage, seconds);
    Bun.write(TIMINGS_FILE, JSON.stringify(timings)).catch(() => {});
  }
  stage = next;
  stageStartedAt = Date.now();
  currentReportId = next === "idle" ? null : reportId;
  void beat(config.deployments);
}

async function beat(deployments: Deployment[]): Promise<void> {
  const { progress, etaSeconds } = estimate(
    stage,
    (Date.now() - stageStartedAt) / 1000,
    timings,
  );
  await Promise.all(
    deployments.map((deployment) =>
      api(deployment, "/api/v1/reports/heartbeat", {
        stage,
        reportId: currentReportId,
        ...(stage === "idle" ? {} : { progress, etaSeconds }),
      }).catch(() => {}),
    ),
  );
}

// --- One report --------------------------------------------------------------

async function setReport(
  deployment: Deployment,
  id: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await api(deployment, `/api/v1/reports/${id}`, body);
  return res.ok;
}

async function freshWorktree(): Promise<void> {
  await must(["git", "fetch", "origin", "master"], REPO);
  if (!existsSync(WORKTREE)) {
    await must(
      ["git", "worktree", "add", "--detach", WORKTREE, "origin/master"],
      REPO,
    );
  }
  await must(["git", "checkout", "--detach", "--force", "origin/master"]);
  await must(["git", "clean", "-fdx", "-e", "node_modules"]);
  await must([process.execPath, "install", "--frozen-lockfile"]);
}

/**
 * Tools by tier. The member list is the important one: no shell and no network
 * of any kind, files in this worktree only, and no MCP servers, whatever the
 * report's text manages to talk the model into.
 */
function agentCommand(report: WatchedReport): string[] {
  const common = [
    "claude",
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(AGENT_SCHEMA),
    "--no-session-persistence",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
  ];
  if (report.trust === "admin") {
    return [...common, "--permission-mode", "bypassPermissions"];
  }
  return [
    ...common,
    "--permission-mode",
    "dontAsk",
    // The tool set itself: what isn't listed doesn't exist for this agent.
    "--tools",
    "Read,Edit,Glob,Grep",
    "--max-budget-usd",
    "3",
    "--allowedTools",
    MEMBER_ALLOWED_TOOLS,
    "--disallowedTools",
    "Bash,PowerShell,WebFetch,WebSearch,Agent,Task,Workflow,Skill,NotebookEdit,Write",
  ];
}

type AgentResult = {
  outcome: "fixed" | "declined" | "needs_human";
  summary: string;
  commitTitle: string;
};

function structured<T>(stdout: string): T | null {
  try {
    const parsed = JSON.parse(stdout) as { structured_output?: T };
    return parsed.structured_output ?? null;
  } catch {
    return null;
  }
}

/** A second opinion that has no tools and has never seen the report. */
async function independentReview(diff: string): Promise<string | null> {
  const result = await run(
    [
      "claude",
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(REVIEW_SCHEMA),
      "--no-session-persistence",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--permission-mode",
      "dontAsk",
      "--tools",
      "",
    ],
    {
      stdin: reviewPrompt(diff),
      cwd: STATE_DIR,
      timeoutMs: 5 * 60_000,
    },
  );
  const verdict = structured<{ approved: boolean; reason: string }>(
    result.stdout,
  );
  if (!verdict) return "the review did not complete";
  return verdict.approved ? null : verdict.reason;
}

/** Everything a change must pass before it may go anywhere. */
async function runChecks(): Promise<string | null> {
  const bun = process.execPath;
  for (const command of [
    [bun, "run", "typecheck"],
    [bun, "x", "biome", "check", "--write", "app", "api", "db", "scripts"],
    [bun, "test"],
  ]) {
    const result = await run(command, { timeoutMs: CHECK_TIMEOUT_MS });
    if (!result.ok) {
      return `${command.slice(1).join(" ")} failed:\n${result.stdout}\n${result.stderr}`.slice(
        -1500,
      );
    }
  }
  return null;
}

async function workingDiff(): Promise<string> {
  await must(["git", "add", "-A"]);
  return must(["git", "diff", "--cached", "--no-color"]);
}

/** Rebase and push, never with force. A moved master just means go again. */
async function pushFix(title: string, reportId: string): Promise<string> {
  await must([
    "git",
    "commit",
    "-m",
    `${title}\n\nReport: ${reportId}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
  ]);
  for (let attempt = 0; attempt < 4; attempt++) {
    await must(["git", "fetch", "origin", "master"]);
    await must(["git", "rebase", "origin/master"]);
    const pushed = await run(["git", "push", "origin", "HEAD:master"]);
    if (pushed.ok) return must(["git", "rev-parse", "HEAD"]);
  }
  throw new Error("could not push after 4 tries");
}

/** Reachable from what's live? A later commit carries this fix too. */
async function isLive(sha: string, version: string): Promise<boolean> {
  if (version === sha) return true;
  const result = await run([
    "git",
    "merge-base",
    "--is-ancestor",
    sha,
    version,
  ]);
  return result.ok;
}

async function waitForImage(sha: string): Promise<boolean> {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await run([
      "gh",
      "run",
      "list",
      "--workflow",
      "build.yml",
      "--commit",
      sha,
      "--json",
      "status,conclusion",
      "--jq",
      '.[0] | .status + " " + .conclusion',
    ]);
    const state = result.stdout.trim();
    if (state.startsWith("completed")) return state.endsWith("success");
    await Bun.sleep(10_000);
  }
  return false;
}

async function waitForDeploy(sha: string): Promise<string | null> {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  let lastNudge = 0;
  while (Date.now() < deadline) {
    if (config.deployCommand && Date.now() - lastNudge > REDEPLOY_NUDGE_MS) {
      lastNudge = Date.now();
      await run(config.deployCommand);
    }
    const versions = await Promise.all(
      config.deployments.map((d) =>
        fetch(`${d.origin}/_version`, { signal: AbortSignal.timeout(10_000) })
          .then((res) => res.text())
          .then((text) => text.trim())
          .catch(() => ""),
      ),
    );
    const live = await Promise.all(
      versions.map((v) => (v ? isLive(sha, v) : Promise.resolve(false))),
    );
    if (live.every(Boolean)) return versions[0] ?? sha;
    await Bun.sleep(10_000);
  }
  return null;
}

function memberFixesToday(): number {
  const today = new Date().toDateString();
  const usage = readJson(USAGE_FILE, { day: today, count: 0 });
  return usage.day === today ? usage.count : 0;
}

function countMemberFix() {
  const next = {
    day: new Date().toDateString(),
    count: memberFixesToday() + 1,
  };
  Bun.write(USAGE_FILE, JSON.stringify(next)).catch(() => {});
}

async function handle(deployment: Deployment, report: WatchedReport) {
  const isAdmin = report.trust === "admin";
  if (!isAdmin && memberFixesToday() >= MEMBER_FIXES_PER_DAY) {
    log(`member cap reached, leaving ${report.id} queued`);
    return;
  }
  const claimed = await setReport(deployment, report.id, {
    status: "working",
    expectStatus: "open",
  });
  if (!claimed) return;
  if (!isAdmin) countMemberFix();
  log(`${report.id} (${report.trust}) on ${deployment.name}`);

  const finish = async (
    status: "fixed" | "declined" | "needs_human",
    resolution: string,
    fixedInBuild?: string,
  ) => {
    log(`${report.id}: ${status}: ${resolution}`);
    await setReport(deployment, report.id, {
      status,
      resolution: resolution.slice(0, 500),
      ...(fixedInBuild ? { fixedInBuild } : {}),
    });
  };

  try {
    enterStage("fixing", report.id);
    await freshWorktree();

    let screenshotPath: string | null = null;
    if (report.screenshotHash) {
      const res = await api(deployment, `/api/blobs/${report.screenshotHash}`);
      if (res.ok) {
        const dir = join(WORKTREE, ".report");
        mkdirSync(dir, { recursive: true });
        screenshotPath = ".report/screenshot.jpg";
        await Bun.write(
          join(WORKTREE, screenshotPath),
          await res.arrayBuffer(),
        );
      }
    }

    const agentRun = await run(agentCommand(report), {
      stdin: agentPrompt(report, screenshotPath),
      timeoutMs: AGENT_TIMEOUT_MS,
    });
    rmSync(join(WORKTREE, ".report"), { recursive: true, force: true });
    const result = structured<AgentResult>(agentRun.stdout);
    if (!result) {
      await finish("needs_human", "The agent stopped without finishing.");
      return;
    }
    if (result.outcome !== "fixed") {
      await finish(result.outcome, result.summary);
      return;
    }

    const diff = await workingDiff();
    const denied = denyListHits(
      `${diff}\n${result.commitTitle}\n`,
      config.denyStrings ?? [],
    );
    if (denied.length > 0) {
      // Don't echo the hits: this text is shown in the app.
      await finish("needs_human", "The fix mentions something private.");
      return;
    }

    // In this order on purpose: nothing a member's report produced gets
    // EXECUTED, not even its tests, until it has passed both of these.
    if (!isAdmin) {
      enterStage("reviewing");
      const problems = memberDiffProblems(parseDiff(diff));
      if (problems.length > 0) {
        log(`${report.id}: gate: ${problems.join("; ")}`);
        await finish("needs_human", "This fix needs an admin to look at it.");
        return;
      }
      const rejected = await independentReview(diff);
      if (rejected) {
        log(`${report.id}: review: ${rejected}`);
        await finish("needs_human", "This fix needs an admin to look at it.");
        return;
      }
    }

    enterStage("checking");
    const failed = await runChecks();
    if (failed) {
      log(`${report.id}: checks: ${failed}`);
      await finish("needs_human", "The fix didn't pass the app's checks.");
      return;
    }
    await must(["git", "add", "-A"]);

    if (noShip) {
      await finish("needs_human", `Dry run, not shipped: ${result.summary}`);
      return;
    }

    enterStage("publishing");
    const sha = await pushFix(result.commitTitle, report.id);
    if (!(await waitForImage(sha))) {
      await finish(
        "needs_human",
        "The fix is committed, but its build failed.",
      );
      return;
    }

    enterStage("deploying");
    const version = await waitForDeploy(sha);
    if (!version) {
      await finish(
        "needs_human",
        "The fix is committed, but it hasn't gone live yet.",
      );
      return;
    }
    await finish("fixed", result.summary, version);
  } catch (err) {
    log(`${report.id}: failed: ${err}`);
    await finish("needs_human", "Something went wrong while fixing this.");
  } finally {
    enterStage("idle");
  }
}

// --- The loop ----------------------------------------------------------------

async function queue(deployment: Deployment): Promise<WatchedReport[]> {
  const res = await api(deployment, "/api/v1/reports?status=open").catch(
    () => null,
  );
  if (!res?.ok) return [];
  return ((await res.json()) as { reports: WatchedReport[] }).reports;
}

/** One watcher at a time, so anything marked working was ours and died. */
async function recoverAbandoned(): Promise<void> {
  for (const deployment of config.deployments) {
    const res = await api(deployment, "/api/v1/reports?status=working").catch(
      () => null,
    );
    if (!res?.ok) continue;
    const { reports } = (await res.json()) as { reports: WatchedReport[] };
    for (const report of reports) {
      await setReport(deployment, report.id, {
        status: "open",
        expectStatus: "working",
      });
    }
  }
}

function stopRunning(): void {
  if (!existsSync(PID_FILE)) {
    console.log("no watcher running");
    return;
  }
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  try {
    process.kill(pid);
    console.log(`stopped ${pid}`);
  } catch {
    console.log(`${pid} was not running`);
  }
  rmSync(PID_FILE, { force: true });
}

if (args.has("--stop")) {
  stopRunning();
  process.exit(0);
}

const configPath = join(REPO, ".report-watcher.local");
if (!existsSync(configPath)) {
  console.error(`missing ${configPath}: see the top of this file`);
  process.exit(1);
}
const config = readJson<Config>(configPath, { deployments: [] });

mkdirSync(STATE_DIR, { recursive: true });
await Bun.write(PID_FILE, String(process.pid));
timings = { ...DEFAULT_TIMINGS, ...readJson(TIMINGS_FILE, {}) };

const heartbeat = setInterval(
  () => void beat(config.deployments),
  HEARTBEAT_MS,
);
await recoverAbandoned();
await beat(config.deployments);
log(
  `watching ${config.deployments.map((d) => d.name).join(", ")}${noShip ? " (no-ship)" : ""}`,
);

while (true) {
  let handled = 0;
  for (const deployment of config.deployments) {
    const reports = await queue(deployment);
    // An admin waiting on an instruction goes ahead of the queue.
    reports.sort(
      (a, b) => Number(b.trust === "admin") - Number(a.trust === "admin"),
    );
    for (const report of reports) {
      await handle(deployment, report);
      handled++;
    }
  }
  if (args.has("--once") && handled === 0) break;
  await Bun.sleep(POLL_MS);
}

clearInterval(heartbeat);
rmSync(PID_FILE, { force: true });
