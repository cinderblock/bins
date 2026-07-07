/**
 * Unauthenticated branding for the signed-out landing page. There is
 * deliberately no entry form behind this — scanning a sticker IS the login;
 * the access-code path lives at the unlinked /join route.
 *
 * Multi-group note: one origin can't know which group a signed-out visitor
 * belongs to, so the FIRST group's branding is served. Per-group branding
 * would need per-group origins — out of scope.
 */
import { asc } from "drizzle-orm";
import { db, schema } from "../db/client.server";
import { json } from "./context";

export async function handleLanding(): Promise<Response> {
  const group = await db.query.group.findFirst({
    orderBy: [asc(schema.group.createdAt)],
  });
  if (!group) return json({ needsSetup: true });
  return json({
    needsSetup: false,
    title: group.landingTitle ?? `${group.name} Inventory Management System`,
    subtitle: group.landingSubtitle ?? "Scan a Box to Start",
  });
}
