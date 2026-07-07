import { normalizeAccessCode } from "../api/auth";
import { sha256Hex } from "../api/context";
/**
 * Create an ADDITIONAL group (the first one comes from the /setup page):
 *   bun scripts/create-group.ts "<name>" "<access code>" ["<admin password>"]
 * The access code is what members type at /join; the admin password gates
 * /admin for this group (omitted = admin surface disabled for the group).
 * Both are stored hashed.
 */
import { db, schema } from "../db/client.server";

const [name, code, adminPassword] = process.argv.slice(2);
if (!name || !code) {
  console.error(
    'usage: bun scripts/create-group.ts "<name>" "<access code>" ["<admin password>"]',
  );
  process.exit(1);
}

const id = crypto.randomUUID();
await db.insert(schema.group).values({
  id,
  name,
  accessCodeHash: sha256Hex(normalizeAccessCode(code)),
  adminPasswordHash: adminPassword ? sha256Hex(adminPassword) : null,
});
console.log(
  `created group "${name}" (${id})${adminPassword ? "" : " — admin surface disabled (no password given)"}`,
);
