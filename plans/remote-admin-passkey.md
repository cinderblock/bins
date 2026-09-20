# Remote admin access, gated by passkey

## Goal

Admins can use the app from the internet; nobody else can. The operator
(2026-09-20): "admins should be able to use the UI from the internet. require
passkey auth for this." Today the warehouse deployment's reverse proxy answers
403 to anything off the LAN, and the app trusts the LAN entirely
(`OPEN_ACCESS=1`: a display name joins). That perimeter stays for members; a
second way in opens for passkey holders.

## Environment / context

- The app: `cinderblock/bins`, this repo. Passkeys landed in `85e8962`
  (`api/passkeys.ts`, `/admin/passkey`, `device.admin_until`).
- The deployment this is for is described in `plans/tsl.local.md` (untracked).
  Its proxy is a Caddy site block in the ops repo with an `@external`
  matcher (not private, not on-link) that currently answers 403, and a LAN
  block that proxies with `X-Bins-Perimeter: lan`.
- Internet clients reach that proxy through a CDN (proxied DNS record, real
  client IP recovered via `trusted_proxies`), so `{client_ip}` is truthful on
  both paths.

## Decisions already made (don't re-ask)

- **Opt-in env, not a default**: `REMOTE_ACCESS=passkey`. Unset (`off`) means
  nothing changes for internet-facing deployments that already run on
  access codes and sticker secrets.
- **What "remote" means**: the request is not on the perimeter — no
  `X-Bins-Perimeter: lan` from the proxy AND not a private forwarded address.
  Same test the open-access join already uses, so the two agree by
  construction.
- **The rule**: from remote, every authenticated API call needs a device with
  a live passkey session (`admin_until` in the future). No password path, no
  access-code path, no sticker join, no first-boot setup, no integration
  tokens — one rule, no exceptions except the passkey ceremony itself.
- **Anonymous passkey login**: a fresh browser from the internet has no
  device, so the login ceremony must work without a token. Options are
  issued with no credential list (discoverable passkeys; registration now
  asks for `residentKey: "required"`), the challenge is keyed by a random
  session id handed to the client, and a verified anonymous login mints a
  member device for the passkey's group with `admin_until` set. The client
  adopts that identity exactly like a join.
- **Client behaviour**: `/api/landing` reports `remote`, and the signed-out
  shell shows a passkey sign-in card instead of the join card when remote.
  A joined device that gets `403 passkey required` (a LAN member off-site, or
  an admin whose 90 days ran out) sees the same card over the app; a sync
  that succeeds clears it.
- **The SPA shell and assets stay public** from the internet. It is a static
  bundle with nothing in it; the data is behind the API. `/api/landing` still
  answers (group title, flags) — accepted.
- **Proxy must strip the perimeter header on the external path**
  (`header_up -X-Bins-Perimeter`): the app cannot tell a forged header from
  the proxy's, by design (the header IS the proxy's word).

## Plan / steps

1. [x] Plan written.
2. [x] Server: `remoteAccess()`, `onPerimeter()`, `isRemote()` in
       `api/config.ts`; router gate; joins/setup refused remotely; anonymous
       passkey login (`session` challenges, device minting); landing flags.
3. [x] Client: deployment flags, `REMOTE_LOCKED_KEY`, `apiFetch` sets it on
       `403 passkey required`, `RemoteSignIn` card in the shell (signed-out
       and locked), `loginWithPasskey` adopts a minted identity.
4. [x] Tests: remote gate on/off, joins refused, landing flags, session
       passes, anonymous options/verify shape. 183 green.
5. [x] README (`REMOTE_ACCESS`, proxy requirement), `.env.example`.
6. [ ] **CURRENT** — Ops (staged, shown, wait for yes): Caddy external block
       proxies without the header; compose `REMOTE_ACCESS: passkey`; pin bump.
7. [ ] Verify live: edge → shell 200, `/api/landing` remote:true, sync 403
       without session, passkey sign-in from a phone on cellular.

## Findings / gotchas

- The sync engine treats 401 as "token dead → re-join", which from remote
  would try `join-open` and fail. The remote refusal is therefore 403 with a
  fixed message, and the client keys off the message, not the status.
- A LAN member whose phone leaves the building with the app open gets the
  locked card. That is the intended behaviour, and the card says why.

## Progress log

- 2026-09-20: plan; server + client + tests + docs done. Browser-verified
  against a second dev API running `REMOTE_ACCESS=passkey` (no proxy, so
  every request reads as remote) with a second Vite on :3010 for a clean
  origin:
  - fresh browser, no identity → "Sign in" card, correctly reporting that the
    dev group has no passkey registered;
  - a device minted through the LAN path, its identity injected into that
    origin's IndexedDB → first API call 403s and the shell swaps to "Sign in
    again to continue", naming the group, with the back-on-the-network button;
  - that API restarted WITHOUT `REMOTE_ACCESS`, then the button tapped → lock
    cleared, app rendered normally.
  - `curl`: landing `remote:true` bare, `remote:false` with
    `X-Bins-Perimeter: lan`; `join-open` from remote → `passkey required`.
  The WebAuthn ceremony itself still needs a real authenticator; the API
  tests cover its options/refusal/replay/enumeration shape.

## Things not to do

- Don't gate the static shell at the proxy with cookies — the app's auth is a
  bearer in IndexedDB, and a cookie gate would be a second identity to keep
  in step.
- Don't make `REMOTE_ACCESS` a group setting: it only makes sense together
  with the proxy config, which is why every perimeter flag is an env var.
