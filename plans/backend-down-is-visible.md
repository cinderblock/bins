# The app must admit when it cannot reach the server

## Goal

The operator, 2026-09-21, with the warehouse instance serving 502:

> is the backend down? The web UI needs to clearly show when it can't connect
> to the backend. The offline features are not critical for the TSL store… a
> PWA that looks like its working but isn't really is a problem. Features that
> need the backend should more clearly indicate when there are backend
> problems.

Two pieces of work: find out why it was down, and make the app say so.

## The outage (root cause, 2026-09-21)

`store.tomsawyerlabs.com` served 502 for hours. Caddy was healthy — other
sites on the same host were fine — and the bins container was crash-looping:

```
error: Cannot find module '@shared/locations'
  from /srv/bins/releases/888eaebd.../api/ai/ask.ts
```

The runtime stage of the Dockerfile copies `server.ts`, `api/`, `shared/`,
`db/` and `release-assets.ts`, **and no `tsconfig.json`** — which is where the
`@shared/*` and `~/*` path aliases are defined. So a server module importing
through an alias type-checks, lints, tests, builds, publishes, and then cannot
boot. Every other server file already imported shared code by relative path;
`api/ai/` (added by a parallel session) was the exception.

Fixed in `59fd649`: four imports made relative, plus
`api/runtime-imports.test.ts`, which walks everything `server.ts` can reach
and fails on any alias specifier. Proven by reintroducing the exact import
that caused the outage and watching the test go red.

The Dockerfile already stated the rule in a comment. A comment cannot fail a
build; a test can.

## Decisions already made (don't re-ask)

- **`navigator.onLine` is not the signal.** During this outage the phone had
  wifi, the LAN was fine, and a healthy proxy answered every request with 502.
  `fetch` resolved. Every offline check in the app said "online". Reachability
  is therefore measured from real traffic (`app/lib/health.ts`).
- **A 5xx counts as unreachable; a 401/403 does not.** A 5xx is what a dead
  app behind a live proxy looks like from the client. A 401 is the app
  talking.
- **The banner shows with ZERO pending changes.** This is the core of the
  complaint. The old banner only appeared when there was unsynced work, so an
  idle device watching a dead server showed nothing at all.
- **Offline-first stays.** Firefly's deployment (Burning Man) depends on it.
  What changes is honesty about the state, not the capability.
- **Server-only actions stay VISIBLE but disabled**, and say why. A control
  that vanishes teaches people the app is broken in some unspecified way; one
  that explains itself teaches them the server is down.
- **Health is not in the Dexie replica.** It is a fact about right now, not
  state worth surviving a reload, and a write per API call would be silly.

## What was built

- `app/lib/health.ts` — a small subscribable store plus a probe. Every API
  call reports its outcome (`app/lib/api.ts`, and the landing fetch in
  `app/lib/deployment.ts`, which is often first to notice on boot). While
  unreachable, `/api/landing` is re-probed on a 3/5/10/20/30s backoff, and on
  `online` / tab-focus, so recovery needs no taps. Redundant notifications are
  suppressed: while down, every request reports in, and re-rendering for the
  twentieth identical failure buys nothing.
- `SyncBanner` — a red "Can't reach the server" banner that outranks the
  others, says how long since it last answered, warns that what you see may be
  out of date, mentions unsynced changes only if there are any, and offers
  Retry.
- `NeedsServer` / `useServerDown` — inline explanation + disabled affordances
  for the things that genuinely cannot work: new box (ids come from one global
  sequence), label preview/print (the printer is on the server's network),
  drawings, sticker-code allocation. An EXISTING box can still be edited
  offline; only allocation is blocked.
- Settings gains a **Server connection** block: connected or not, when it last
  answered, the last error text, and "Check now".

## Verified

Against a production build served with a switch that makes the API answer 502
like a crash-looping container behind a healthy proxy:

| State | What the app does |
| --- | --- |
| Healthy | No banner; "New box" enabled |
| 502, nothing queued | Red banner, Retry, "New box (server down)" disabled |
| 502, Settings | "Can't be reached… Last error: server returned 502" |
| Recovered | Banner clears by itself ~4s later, no interaction |

Request counting confirmed the probe backs off (1–2 `/api/landing` per 10s)
rather than hammering. `app/lib/health.test.ts` covers the verdict machine and
the probe; `api/runtime-imports.test.ts` covers the outage's actual cause.

The label studio's gate could not be driven in the headless preview (its sheet
would not open there — a harness flake hit repeatedly in this session), so
that one is the same verified hook feeding a `disabled` prop, not an
independently observed behaviour.

## Things not to do

- Don't use `navigator.onLine` to decide whether a server-backed feature can
  work. It answers a different question.
- Don't hide a server-only control when the server is down. Disable it and
  say why.
- Don't import through `@shared/*` or `~/*` anywhere `server.ts` can reach.

## Open

- `bun run lint` is red on master from CRLF line endings in files committed by
  a parallel session (`api/ai/*`, plus `api/admin.ts`, `api/config.ts`,
  `api/router.ts`, `api/sync.ts`, `shared/reducer.ts`). Not touched here to
  avoid colliding with in-flight work. CI gates on typecheck and tests only,
  so it does not block a build.
