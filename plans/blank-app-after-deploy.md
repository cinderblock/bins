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
- [x] Deployed and verified in a browser against the live site: the precache
      now holds 70 entries INCLUDING `/assets/manifest-<hash>.js` and the
      shell (it held neither before); `/api/recover` un-strands a device and
      an IndexedDB canary survives it; a chunk from a pruned build is served
      from a prior release (`x-bins-prior-release: c97b584…`).
- [ ] Still not driven by hand: the boot watchdog firing on a genuinely stale
      shell, and a true offline boot (no tooling here to force the browser
      offline). Both are verified by construction — the precache now contains
      every file offline boot needs.

## What went wrong DURING the fix (read this before the next deploy)

Three self-inflicted problems, all worth keeping:

1. **The first fix took both sites down (502).** `deploy.yml` stages a
   hand-listed set of files, and `release-assets.ts` — a new root-level module
   `server.ts` imports — was not on it. It built, staged, and then died on
   every start. The symlink flip happens BEFORE the health check, so the
   failure landed on production instead of failing CI. Fixed by adding the
   file, then by adding a **preflight**: the staged release is booted on a
   throwaway socket and `DATABASE_PATH` and must answer `/_version` before
   `current` is flipped.
2. **A CDN cache re-broke every device we repaired.** `/sw.js` was being served
   `cf-cache-status: HIT` with `Age: 2891` under a four-hour TTL, so a
   just-repaired device re-registered the STALE worker. The worker moved to
   `service-worker.js` (a path the CDN never cached) and the origin now sends
   `no-cache` for it.
   NOTE: Cloudflare REWRITES that header — the response arrives as
   `max-age=14400, must-revalidate` (its Browser Cache TTL override).

   **No Cloudflare rule is needed for this, and an earlier version of this
   plan wrongly said one was.** Measured rather than assumed:
   - The edge honours `no-cache`: repeated requests to `/service-worker.js`
     return `cf-cache-status: EXPIRED` with **no `Age` header**, i.e. CF
     revalidates against the origin every time and never serves a stale
     worker. The original failure looked completely different — `HIT` with
     `Age: 2891` — and that was back when the ORIGIN said
     `public, max-age=3600`. Fixing the origin header fixed the edge.
   - The rewritten `max-age` is inert for the file that matters. The
     registration reports `updateViaCache: "imports"` (checked live), so the
     browser never consults its HTTP cache for the top-level worker script.

   Residual, and genuinely minor: `/push-sw.js` IS an imported script, so
   "imports" means a browser may reuse it for up to 4h. It is unhashed, so a
   changed push handler can take that long to reach a device. Nothing to do
   with booting, and fixable in-repo (build-stamped import URL) if it ever
   matters — still no CF change.
3. **`no-store` on `/push-sw.js` silently killed precaching.** The generated
   worker `importScripts("/push-sw.js")` on the line ABOVE `precacheAndRoute`,
   so an unstorable response there aborted the module before precaching was
   ever registered: the worker installed and activated with an EMPTY cache,
   the app worked fine online, and offline boot was dead. Diagnosed by
   comparing production (zero caches) against an identical local build (70
   entries). Use `no-cache`, never `no-store`, for anything a worker imports.

## The OTHER bug: an invisible column that ate every click

Found 2026-08-09 after the user reported, for the fourth time, a control that
was visibly there and did nothing. It was never the service worker.

`<Notifications position="bottom-center" style={{ bottom: TOAST_BOTTOM }} />`
in `app/root.tsx`. Mantine's container also sets `top: 16px`, so supplying
only `bottom` stretched the fixed element between the two: measured live at
**440 × 1889 px**, `position: fixed`, `pointer-events: auto`, `z-index: 400`,
running the full height of the viewport down the middle of the screen —
holding **zero notifications**. `document.elementFromPoint()` at the centre of
the "Enter access code" button returned `mantine-Notifications-root`, not the
button.

On a phone, 440px IS the width of the screen, so essentially the whole app was
untappable. This explains every report that looked like staleness but wasn't:
buttons that "aren't clickable", inputs "greyed out and not editable" (they
were neither — they just couldn't be focused), `/admin` that "doesn't do
anything", "no interaction" in iOS Safari.

Introduced with `TOAST_BOTTOM` (2026-08-04, the undo work), which is when the
field reports started.

Fix: `top: "auto"` restores the intended geometry (height went 1889 → 0), and
`pointerEvents: "none"` on the container with `auto` on the notifications
guarantees it can never intercept anything again whatever its geometry.

**Method note — the oracle that lied.** A coordinate click through the Chrome
automation produced NO click event in the page at all (verified with a capture
-phase listener: zero events). It fails silently and looks identical to "the
app ignored the click", and it cost real time by making a working control look
broken and a broken one look untested. Use `document.elementFromPoint()` at an
element's centre — that IS the browser's hit test, the same one a finger uses.

## Things not to do

- Don't set only `bottom` (or only `top`) on a Mantine `Notifications`
  container, and don't ever leave it `pointer-events: auto`.
- Don't trust a coordinate click from the browser automation as evidence that
  a control does or doesn't work. It frequently delivers nothing. Hit-test
  with `elementFromPoint`, and drive behaviour with a dispatched `.click()`.

- Don't serve `no-store` for the service worker or anything it
  `importScripts`. Use `no-cache` — revalidated, but still storable.
- Don't add a root-level module `server.ts` imports without adding it to
  `deploy.yml`'s copy list. The preflight now catches this, but the list is
  still hand-maintained.
- Don't compare filesystem paths built with string interpolation. Everything
  here goes through `node:path` `join`, on both sides, so the tests behave the
  same on Windows and Linux with no separator patching.

- Don't "fix" this by dropping `registerType: "prompt"` — that trades this bug
  for lost captures.
- Don't trust a green build here: the whole failure is invisible to typecheck,
  lint and the test suite. The oracle is the generated `build/client/sw.js`
  precache list.
