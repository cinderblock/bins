# Blank app after a deploy — the route manifest is never precached

Incident opened 2026-08-09: the deployed site showed `bins…` (the
`HydrateFallback`) forever, on every route, on the operator's devices. The
first fix attempt (`22b3c8d`, 2026-08-04) treated the symptom and left the
cause in place. Companion plan: `plans/bins.md`.

## Goal

Make a deploy stop stranding already-installed devices, and make offline boot
actually work. Both fail for the same single reason.

## Diagnosis (2026-08-09) — CONFIRMED, not a theory

The server is healthy and running the newest commit. Reproduced live, then
proved each link:

1. `GET /` from curl serves an index.html referencing
   `/assets/manifest-bfdb40c1.js`, which the server returns 200. Server side
   is fine.
2. The browser, controlled by an installed service worker, was served a
   *different* index.html from the SW precache — one referencing
   `/assets/manifest-0836a2d4.js`. That file is gone from the release tree and
   returns 404 (correctly, since `22b3c8d`).
3. **The route manifest is missing from the precache manifest.** Dumping the
   72 precache entries out of the deployed `sw.js` shows every other chunk
   (`entry.client-*`, `root-*`, every route chunk, the wasm, the icons,
   `/index.html`) and **no `manifest-*.js` at all**. React Router writes it
   after the client bundle closes, so `globPatterns` never sees it — the exact
   same late-write problem `additionalManifestEntries` already works around
   for `/index.html`, but only `/index.html` was listed.
4. So on every load the precached shell asks the *network* for its route
   manifest. That works right up until a deploy replaces it, at which point
   the module graph fails, hydration never happens, and the page sits on
   `bins…`.
5. The `22b3c8d` self-heal never runs: it is a `useEffect` inside
   `HydrateFallback`, and hydration is precisely what is broken.
   `sessionStorage["bins:boot-recovery"]` was still `null` on a stuck page —
   measured, not assumed.
6. Unregistering the SW and dropping Cache Storage (IndexedDB untouched) makes
   the app boot normally. That is the whole failure.

### What this means

- **Every deploy permanently bricks every installed device**, until someone
  clears the service worker by hand. `registerType: "prompt"` guarantees the
  new worker stays waiting, and the prompt that would activate it is a
  component inside the app that can no longer boot.
- **Offline boot has never worked.** A device with no network cannot fetch the
  one asset that was never precached. The precached shell is useless without
  it. This undercuts the app's whole premise (storage units, dead zones).

## Decisions already made (don't re-ask)

- `registerType: "prompt"` stays. Auto-activating a worker mid-capture can
  lose work; that decision predates this bug and this bug is not a reason to
  revisit it.
- `generateSW` stays (no switch to `injectManifest`) — same reasoning as
  `plans/mobile-ux-and-suggestions.md` phase 3: the generated SW is
  load-bearing and not worth owning.

## Plan / steps

1. **Precache the route manifest** (root cause). Teach the build to add the
   real `assets/manifest-*.js` to the precache alongside `/index.html`.
   Needs a local `bun run build` to confirm where in the plugin order the file
   appears, then a check that `build/client/sw.js` lists it.
2. **Serve `/assets/*` from previous releases** (defence in depth, and the
   only thing that rescues devices already stranded *today*). `deploy.yml`
   keeps the last 5 release trees; `serveAsset` in `server.ts` should fall
   back to searching them before answering 404. A stale shell then keeps
   working, boots, and shows the normal update prompt. Zero user action, zero
   data loss.
3. **Move the boot watchdog out of React.** The recovery must not depend on
   hydration — an inline `<script>` in the prerendered shell, cleared by the
   app once it boots. Only helps future breakage (a stranded device is
   stranded on an *old* shell), which is exactly what it is for.

## Findings / gotchas

- The SW's `navigateFallbackDenylist: [/^\/api\//]` is already deployed, so a
  navigation to `/api/<anything>` bypasses the service worker and reaches the
  server. That is the one lever that still works on a stranded device — usable
  for a `/api/recover` rescue page if steps 1–2 ever prove insufficient.
- Do NOT tell anyone to "clear website data" on iOS: that deletes IndexedDB,
  which is where the replica, the op outbox and un-uploaded photos live.
  Unregistering the worker and dropping Cache Storage is enough and is safe.
- Chrome automation flakiness from the other plan holds: `Page.captureScreenshot`
  times out every few calls. Network-request inspection was the reliable oracle
  here — it is what surfaced the 503/404 on the manifest chunk.

## What users reported while this was being fixed (2026-08-09)

Mid-fix, from the live deployment: inputs "greyed out and not editable" in
Chrome on iOS, `/admin` doing nothing, "I have an access code" doing nothing,
Safari not responding either.

That is the SAME bug seen from a device whose shell *did* boot: every route
here is a lazily-loaded chunk. A stale shell that still has its already-fetched
chunks in the HTTP cache (assets are `immutable`, one year) renders fine, but
the first navigation to a route it had never visited asks for a chunk the
release tree no longer has, gets a 404, and the navigation silently does
nothing. Chrome on iOS has no service workers at all, which is why the HTTP
cache — not the worker — is the load-bearing part of that variant.

Ruled out on the way: Cloudflare is NOT caching the shell (`/` comes back
`cf-cache-status: DYNAMIC`, `Cache-Control: no-cache`), so this is entirely
client-side.

Step 2 is what fixes this class outright, which is why it shipped first.

## Progress log

- [x] Reproduced live, root-caused to the missing precache entry (above).
- [x] Step 1 — precache `assets/manifest-*.js`
      (`scripts/precache-route-manifest.ts`, run from `bun run build`). A Vite
      plugin CANNOT do this: React Router writes the file after the whole Vite
      build, so even a `closeBundle` ordered `post` runs too early — tried, and
      it failed with "no assets/manifest-*.js in the client build". The script
      asserts what it produced and exits non-zero if the precache is wrong.
- [x] Step 2 — prior-release asset fallback (`release-assets.ts`, used by
      `server.ts`), with 6 tests over a real on-disk release layout.
      `realpathSync` first: the supervisor launches `<root>/current/run`, so
      without resolving the symlink the "siblings" would be `<root>/*` and the
      fallback would silently find nothing.
- [x] Step 3 — boot watchdog moved from a `HydrateFallback` `useEffect` into an
      inline `<script>` in the prerendered shell (`bootWatchdogJs` in
      `app/root.tsx`); `App` sets `window.__binsBooted` once hydration happens.
- [x] Verified locally: build emits 73 precache entries including
      `/assets/manifest-<hash>.js`, matching what index.html references (was 72
      without it); watchdog present in the prerendered index.html; typecheck,
      lint and 106 tests green.
- [ ] Deploy and confirm a stranded device recovers untouched.
- [ ] Not yet exercised in a browser: the watchdog actually firing on a stale
      shell, and offline boot. Both were verified by construction, not by
      driving them — the user asked to ship without waiting for that.

## Things not to do

- Don't "fix" this by dropping `registerType: "prompt"` — that trades this bug
  for lost captures.
- Don't trust a green build here: the whole failure is invisible to typecheck,
  lint and the test suite. The oracle is the generated `build/client/sw.js`
  precache list.
