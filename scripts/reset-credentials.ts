/**
 * Set a group's access code and/or admin password, without knowing the old
 * ones and without touching any data.
 *
 * The lockout this exists for: both credentials are stored as hashes, /admin
 * requires the CURRENT admin password to rotate anything, and the access code
 * is only cached on devices that already joined. Forget both with no device
 * signed in and there is no way back in through the app — while every box,
 * photo and note sits there perfectly intact. Recreating the database would
 * "fix" it by destroying all of that; this changes two columns on one row.
 *
 * Usage, from the release directory on the host:
 *
 *   bun scripts/reset-credentials.ts --show
 *   bun scripts/reset-credentials.ts --access-code "new code"
 *   bun scripts/reset-credentials.ts --admin-password "new password"
 *   bun scripts/reset-credentials.ts --group <id> --access-code "x"
 *
 * With one group (the normal case) --group can be omitted.
 */
import { eq } from "drizzle-orm";
import { normalizeAccessCode } from "../api/auth";
import { sha256Hex } from "../api/context";
import { db, schema } from "../db/client.server";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

const groups = await db.query.group.findMany();
if (groups.length === 0) {
  console.error("no groups exist — open the site and run first-boot /setup");
  process.exit(1);
}

const wantedId = arg("group");
const group = wantedId
  ? groups.find((g) => g.id === wantedId)
  : groups.length === 1
    ? groups[0]
    : undefined;

if (!group) {
  console.error(
    wantedId
      ? `no group with id ${wantedId}`
      : "several groups exist — pass --group <id>:",
  );
  for (const g of groups) console.error(`  ${g.id}  ${g.name}`);
  process.exit(1);
}

const newCode = arg("access-code");
const newAdmin = arg("admin-password");

if (has("show") || (!newCode && !newAdmin)) {
  console.log(`group:         ${group.name} (${group.id})`);
  console.log(
    `access code:   ${group.accessCode ?? "unknown — set one to make it readable"}`,
  );
  console.log(
    `admin password: ${group.adminPasswordHash ? "set (hash only, never readable)" : "NOT SET — admin surface disabled"}`,
  );
  if (!has("show")) {
    console.log(
      "\nnothing changed. Pass --access-code and/or --admin-password.",
    );
  }
  process.exit(0);
}

const updates: Partial<typeof schema.group.$inferInsert> = {};
if (newCode) {
  updates.accessCode = newCode.trim();
  updates.accessCodeHash = sha256Hex(normalizeAccessCode(newCode));
}
if (newAdmin) updates.adminPasswordHash = sha256Hex(newAdmin);

await db.update(schema.group).set(updates).where(eq(schema.group.id, group.id));

console.log(`updated group "${group.name}" (${group.id}):`);
if (newCode) console.log(`  access code    -> ${newCode.trim()}`);
if (newAdmin) console.log("  admin password -> set");
console.log(
  "\nNo boxes, photos, notes or devices were touched. Existing devices stay\n" +
    "signed in — the access code only gates NEW joins.",
);
