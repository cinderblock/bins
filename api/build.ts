/**
 * The commit this release was built from.
 *
 * CI writes a BUILD_SHA file into the release tree (see deploy.yml) and
 * server.ts serves it at /_version so a deploy can confirm the new build took
 * over. It is also what /admin compares each device's self-reported build
 * against, to show who is still running old code.
 *
 * Lives here rather than in server.ts because both that and the API need it,
 * and api/ is already part of the release tree — a new top-level file would
 * have to be added to deploy.yml's copy list, which is exactly the omission
 * that once took the site down.
 */
import { readFileSync } from "node:fs";

export const BUILD_SHA: string = (() => {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA.trim();
  try {
    return readFileSync(`${import.meta.dir}/../BUILD_SHA`, "utf8").trim();
  } catch {
    return "dev";
  }
})();
