import { normalizeAccessCode } from "../api/auth";
import { sha256Hex } from "../api/context";
/**
 * Create a group: bun scripts/create-group.ts "<name>" "<access code>"
 * The access code is what members type on first run; it is stored hashed.
 */
import { db, schema } from "../db/client.server";

const [name, code] = process.argv.slice(2);
if (!name || !code) {
  console.error('usage: bun scripts/create-group.ts "<name>" "<access code>"');
  process.exit(1);
}

const id = crypto.randomUUID();
await db.insert(schema.group).values({
  id,
  name,
  accessCodeHash: sha256Hex(normalizeAccessCode(code)),
});
console.log(`created group "${name}" (${id})`);
