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
import { isOpenAccess } from "./config";
import { json } from "./context";

export async function handleLanding(): Promise<Response> {
  const group = await db.query.group.findFirst({
    orderBy: [asc(schema.group.createdAt)],
  });
  // `openAccess` rides the one endpoint a signed-out visitor can already
  // reach, so the SPA knows which gate to render before it has any token.
  if (!group) return json({ needsSetup: true, openAccess: isOpenAccess() });
  return json({
    needsSetup: false,
    openAccess: isOpenAccess(),
    title: group.landingTitle ?? `${group.name} Inventory Management System`,
    subtitle: group.landingSubtitle ?? "Scan a Box to Start",
  });
}
