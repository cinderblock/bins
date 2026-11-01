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
6. [ ] Ship reporting, verify on the live sites. (current step)
7. [ ] `scripts/report-watcher.ts`, then a dry run against a seeded report.
8. [ ] Integration tokens from the operator, start the watcher on request.

## Findings / gotchas

- `reloadBlockedBy` let a hidden page reload whatever was on it, so switching
  apps mid-note lost the note. That rule predates this work and is the exact
  loss the operator ruled out.
- **The "is a sheet open?" check was always true on pages with a sheet.**
  Mantine leaves a closed sheet's `.mantine-Drawer-root` in the page, so the
  guard matched closed sheets. It went unnoticed because a hidden page skipped
  the check. Found by a real reload in headless Chrome: `blocker: "overlay open"`
  with both drawers closed. Now matches `-content`, which only exists while open.
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

## Things not to do

- Don't let a member report's text reach a tool that can run commands.
- Don't push with force, ever. Rebase onto origin/master and retry.
- Don't put a raw report into a commit message: this repo is public.
- Don't add `plans/local.md` details to tracked files, this one included.
