/**
 * Add React Router's route manifest to the service worker's precache.
 *
 * `build/client/assets/manifest-<hash>.js` is written at the very END of
 * `react-router build` — after the Vite build has closed, so vite-plugin-pwa
 * has already generated `sw.js` and its `globPatterns` never saw the file.
 * (A Vite plugin cannot fix this: even a `closeBundle` ordered `post` runs
 * before React Router writes it.) It was the ONLY build artifact missing from
 * the precache, and it is the one the shell cannot boot without.
 *
 * What that cost: the precached shell fetched its route manifest from the
 * network on every load. Fine while that build was live — then a deploy
 * replaced it, the shell asked for a file the release tree no longer had,
 * hydration died, and the app sat on `bins…` forever. The update prompt that
 * would have replaced the stale worker is a component inside the app that
 * could no longer start, so every deploy permanently stranded every installed
 * device. Offline boot never worked either, for the same one reason.
 *
 * This runs as a build step (see package.json) and rewrites the generated
 * worker in place. It asserts what it produced, and exits non-zero if the
 * precache is wrong: the failure is invisible to typecheck, lint and the test
 * suite, so the build has to be the thing that refuses to ship it again.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { SERVICE_WORKER_FILENAME } from "../release-assets";

const CLIENT_OUT = "build/client";
const SW = `${CLIENT_OUT}/${SERVICE_WORKER_FILENAME}`;

function fail(message: string): never {
  console.error(`precache-route-manifest: ${message}`);
  process.exit(1);
}

const routeManifests = readdirSync(`${CLIENT_OUT}/assets`).filter((f) =>
  /^manifest-[^/]+\.js$/.test(f),
);
const [routeManifest] = routeManifests;
if (routeManifests.length !== 1 || !routeManifest) {
  fail(
    `expected exactly one assets/manifest-*.js, found ${routeManifests.length} (${routeManifests.join(", ") || "none"}) — the route manifest moved or was renamed; this script needs updating`,
  );
}
const url = `/assets/${routeManifest}`;

const original = readFileSync(SW, "utf8");
// Hashed filename: immutable, so no revision. Workbox rejects a duplicate URL
// with a different revision, which makes a double-run loud rather than silent.
const marker = "precacheAndRoute([";
if (!original.includes(marker)) {
  fail(`no ${marker} call in ${SW} — the generated worker's shape changed`);
}
const patched = original.replace(
  marker,
  `${marker}{url:${JSON.stringify(url)},revision:null},`,
);

// Verify against the bytes actually written, not against intent.
const urls = [
  ...patched.matchAll(/\{url:"([^"]+)",revision:(?:null|"[^"]*")\}/g),
].flatMap((m) => m[1] ?? []);
const count = (re: RegExp) => urls.filter((u) => re.test(u)).length;

const problems: string[] = [];
if (count(/^\/assets\/manifest-[^/]+\.js$/) !== 1) {
  problems.push("route manifest is not precached exactly once");
}
if (count(/(^|\/)index\.html$/) !== 1) {
  problems.push("index.html is not precached exactly once");
}
// A worker that precaches itself can never be replaced. Root-level only:
// `assets/workbox-window.*` is the registration helper the APP imports, and
// it belongs in the precache.
if (count(/^\/?(sw|workbox-[0-9a-f]+)\.js$/) !== 0) {
  problems.push("the service worker precaches itself");
}
if (problems.length) {
  fail(`${problems.join("; ")}\nentries (${urls.length}): ${urls.join(", ")}`);
}

writeFileSync(SW, patched);
console.log(
  `precache-route-manifest: precached ${url} (${urls.length} entries total)`,
);
