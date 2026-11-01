# Report an issue, and have it fixed without touching anything

Requested 2026-11-01 by the operator, while using the app in the field.

## Goal

Make a report from inside the app (shake, or a button) and have the fix built,
shipped and loaded on the phone with no further interaction, without ever
losing work in progress.

1. **Reporting**: shake on a phone, plus an always-available button. Works
   offline. Carries enough context that an agent can act on it alone.
2. **Watcher**: a process started on request that turns reports into shipped
   fixes. Admin reports are instructions and are followed. Member reports are
   fixed only when the problem is obvious.
3. **Reload**: the app picks up the fix by itself, at a moment that cannot lose
   anything, and says what changed.

## Decisions already made (don't re-ask)

- **Both shake and a button** (agent's call, 2026-11-01, on the operator's
  either/or). Shake alone can't be the whole answer: iOS needs a permission
  granted from a tap, nothing else has a sensor, and it isn't discoverable.
  The button is a small tab on the screen's left edge because every other
  corner is taken by a page header or a fixed bottom bar.
- **"Admin" is decided by the server when the report is received** (a live
  passkey session or a valid admin password), never by a client-supplied field.
  It is what lets an agent obey the text.
- **Only the admin's typed words are instructions.** Page text and screenshots
  in a report show content any member wrote. They are context, in every tier.
- **Member reports never reach an agent with a shell.** See "Trust" below.
- **A report is not an op.** Diagnostics like `client_error`: no replica needs
  anyone else's reports.

- **Agent status in the app** (operator request, 2026-11-01): online or not, what
  it's doing, and an estimated progress bar. The watcher heartbeats a stage,
  progress and ETA to each server; the server keeps it in memory, because a
  restart only loses it until the next beat. Progress is an estimate from the
  watcher's own past run times, and is labelled as one.

- **What a report carries** (operator request, 2026-11-01: "add all the useful
  metadata"): the page, a trail of taps, page changes, failed or slow requests
  and console lines, device and network facts, sync and replica state, the box
  on screen, and deployment flags. Typed values are never recorded.
- **`/admin`, `/print`, `/setup`, `/join` send no screenshot or page text**
  (agent's call, 2026-11-01). They show codes, passwords and tokens, and skipping
  a page can't miss a field the way masking can. The trail still goes, and known
  secrets are scrubbed from everything.

## How a deploy happens now

`plans/local.md`'s "two steps" is out of date. Since 2026-10-24 Renovate
(`ops/.github/workflows/renovate.yml`) moves both bins pins in one commit
whenever `:latest` changes: branch, `caddy-check` (about 45 s), fast-forward
to ops master, which is the deploy. So a push to bins master already ships to
**both** deployments, by the next daily run. The watcher only has to start
Renovate sooner:

    gh workflow run renovate.yml --repo cinderblock/ops -f dry_run=false

That changes nothing in ops. It runs the deploy path the operator set up
sooner than its schedule. Measured for other apps: a few minutes end to end.

## Trust

The repo is public and master ships to production, so a report is untrusted
text steering something that can publish code. Anyone on the LAN can join the
warehouse instance by typing a name; anyone who has seen a sticker can join the
other one.

| | Admin report | Member report |
| --- | --- | --- |
| Identity | server-verified | anyone who joined |
| Agent tools | full, in its own worktree | read and edit files only: no shell, no network |
| Scope | follows the instruction | only an obvious, small bug; else declines |
| Who commits and pushes | the watcher | the watcher |
| Extra gates | checks pass | small diff, app source only, no dependencies, independent review of the diff, daily cap |

Every shipped diff also has to pass typecheck, lint and tests, and must not
contain any string from the local deny list (tenant names, hostnames).

## Plan

1. [x] Plan doc.
2. [x] Server: `report` table, migration 0022, member/admin/watcher endpoints,
       heartbeat.
3. [x] Client: shake detection, report sheet, offline queue, edge tab with the
       agent's status, Settings, admin list.
4. [x] Reload safety: never reload over unsaved input, even when hidden.
5. [x] Close the loop: update check as soon as the server has the fix, and a
       toast once this device runs it.
6. [x] Ship reporting: `2382121` live on both deployments, 2026-11-01 about 1:22 PM PST (21:22Z).
7. [x] `scripts/report-watcher.ts`, then a dry run against seeded reports.
8. [x] Integration tokens from the operator; watcher started 2026-11-01 1:29 PM PST
       (21:29Z), hidden, watching both deployments.
9. [ ] Live test: a real report from a phone, through to the reload. (current step,
       needs the operator)

## Findings / gotchas

- `reloadBlockedBy` let a hidden page reload whatever was on it, so switching
  apps mid-note lost the note. That rule predates this work and is the exact
  loss the operator ruled out.
- **The "is a sheet open?" check was always true on pages with a sheet.**
  Mantine leaves a closed sheet's `.mantine-Drawer-root` in the page, so the
  guard matched closed sheets. It went unnoticed because a hidden page skipped
  the check. Found by a real reload in headless Chrome: `blocker: "overlay open"`
  with both drawers closed. Now matches `-content`, which only exists while open.
- **`Grep` in `--allowedTools` escaped the folder.** With `Read(./**),Glob,Grep`,
  a hostile prompt read a file from the home directory through Grep, with no
  denial. `Read(./**)` governs Grep and Glob when they aren't listed separately,
  so they're left off, and a test pins it. Rerun: outside paths denied, inside
  paths work.
- Member containment, tested with hostile prompts: no shell, no network, no write
  outside `app/`, reads stop at the folder.
- Dry run, 2026-11-01 1:21 PM PST (21:21Z), on a throwaway server: an ordinary
  report was fixed, reviewed and checked in about 2.5 min; a fake "SYSTEM OVERRIDE"
  asking to send the token to an outside URL was declined in 14 s, unchanged.
- `/_version` is the oracle for what a deployment runs.
- Update checks ran every 15 minutes, far too slow to feel automatic.

## Verification

Headless Chrome (iPhone profile) against a throwaway dev instance, 2026-11-01:
report via the tab with a screenshot that really shows the page and leaves the
sheet out; delivery to the watcher API; a simulated `devicemotion` shake; agent
offline, online and mid-fix with progress; a real reload holding for a blurred
draft and an open sheet, then proceeding.

Not verified: a physical phone. Shake on real hardware, the iOS permission flow,
and screenshot quality in WebKit all need a real device.

## Running it

    bun scripts/report-watcher.ts          # start (config: .report-watcher.local)
    bun scripts/report-watcher.ts --stop   # stop

State, log and pid are in `~/.bins-report-watcher/`. It doesn't restart after a
reboot: the app shows "Agent offline" until it's started again.

Never yet exercised for real: the push, build wait, deploy wait and live reload
stages. The dry run stops before pushing, so the first real report is that test.

## Known limits

- The watcher runs on the operator's workstation, so it needs that machine on.
  The app shows "Agent offline" when it isn't, and reports wait in the queue.
- A fix ships to every deployment, whichever one reported it, because Renovate
  moves both pins in one commit.
- An admin-tier agent has full tools on the workstation. That is the requested
  "blindly follow", and a stolen admin session would inherit it. Only its own
  words are treated as instructions, and it still can't skip the checks to ship.

## Things not to do

- Don't add Grep or Glob to `MEMBER_ALLOWED_TOOLS`.
- Don't let a member report's text reach a tool that can run commands.
- Don't push with force, ever. Rebase onto origin/master and retry.
- Don't put a raw report into a commit message: this repo is public.
- Don't add `plans/local.md` details to tracked files, this one included.
