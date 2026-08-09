/**
 * Log each group's access code at startup.
 *
 * Requested by the operator after being locked out of their own deployment:
 * the code was only ever stored as a hash, so a forgotten one could be
 * replaced but never read — not even by the person running the server. The
 * server log is somewhere an operator can always reach.
 *
 * The trade is explicit: anyone who can read the log, or the database, can
 * join the group. That is a smaller step than it sounds for this app — the
 * access code is a shared secret that every joined device already caches in
 * plaintext locally to build invite links, and the access model is
 * deliberately low-security by design (seeing one sticker gets you in). It is
 * still a real exposure, and the reason it's a considered decision rather than
 * an accident.
 *
 * The admin password is NOT logged and stays hash-only: it is the one
 * credential that gates destructive actions, and it has a reset path
 * (scripts/reset-credentials.ts) that does not require knowing the old one.
 */
import { db } from "../db/client.server";

/**
 * On by default, because being locked out of your own inventory is the failure
 * this exists to prevent and it is far more likely than someone reading the
 * log. A self-hoster who ships logs somewhere they don't control can turn it
 * off — the code is still readable in /admin and via reset-credentials.
 */
function loggingEnabled(): boolean {
  const raw = process.env.LOG_ACCESS_CODE?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export async function logGroupCredentials(): Promise<void> {
  if (!loggingEnabled()) return;
  try {
    const groups = await db.query.group.findMany({
      columns: { name: true, accessCode: true, adminPasswordHash: true },
    });
    if (groups.length === 0) {
      console.log("bins: no group yet — first visit will open /setup");
      return;
    }
    for (const g of groups) {
      const code = g.accessCode ?? "unknown (set before codes were readable)";
      const admin = g.adminPasswordHash ? "set" : "NOT SET (admin disabled)";
      console.log(
        `bins: group "${g.name}" — access code: ${code} | admin password: ${admin}`,
      );
    }
    console.log(
      "bins: reset either with `bun scripts/reset-credentials.ts` in the release dir",
    );
  } catch (err) {
    // Never let a logging convenience stop the server booting.
    console.error("bins: could not read group credentials:", err);
  }
}
