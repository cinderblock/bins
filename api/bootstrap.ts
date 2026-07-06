/**
 * Optional first-boot group creation: if BOOTSTRAP_GROUP_NAME +
 * BOOTSTRAP_ACCESS_CODE are set and no group exists yet, create one — so a
 * self-hoster can bring up a working instance from env alone. Equivalent to
 * `bun scripts/create-group.ts`.
 */
import { db, schema } from "../db/client.server";
import { normalizeAccessCode } from "./auth";
import { sha256Hex } from "./context";

export async function bootstrapGroup(): Promise<void> {
  const name = process.env.BOOTSTRAP_GROUP_NAME;
  const code = process.env.BOOTSTRAP_ACCESS_CODE;
  if (!name || !code) return;
  const existing = await db.query.group.findFirst();
  if (existing) return;
  await db.insert(schema.group).values({
    id: crypto.randomUUID(),
    name,
    accessCodeHash: sha256Hex(normalizeAccessCode(code)),
  });
  console.log(`bootstrapped group "${name}"`);
}
