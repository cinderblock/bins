/**
 * Unauthenticated branding for the signed-out landing page. There is
 * deliberately no entry form behind this — scanning a sticker IS the login;
 * the access-code path lives at the unlinked /join route.
 *
 * Multi-group note: one origin can't know which group a signed-out visitor
 * belongs to, so the FIRST group's branding is served. Per-group branding
 * would need per-group origins — out of scope.
 */
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.server";
import {
  boxNumbers,
  homeView,
  isOpenAccess,
  isRemote,
  labelPrintUrl,
  pushPublicKey,
} from "./config";
import { json } from "./context";
import { artAvailable } from "./labels/art";

export async function handleLanding(req: Request): Promise<Response> {
  const group = await db.query.group.findFirst({
    orderBy: [asc(schema.group.createdAt)],
  });
  // Off the perimeter on a REMOTE_ACCESS=passkey deployment: the SPA must
  // offer the passkey sign-in and nothing else. `openAccess` is reported
  // false from there so the name-only join card never renders where the
  // join it would attempt is refused anyway.
  const remote = isRemote(req);
  // These ride the one endpoint a signed-out visitor can already reach, so the
  // SPA knows which gate — and which home surface — to render before it has
  // any token. Needed at /setup time too, which is pre-identity.
  if (!group)
    return json({
      needsSetup: true,
      openAccess: isOpenAccess() && !remote,
      remote,
      passkeys: false,
      homeView: homeView(),
      boxNumbers: boxNumbers(),
      labelPrinting: labelPrintUrl() !== null,
      labelArt: artAvailable(),
      pushPublicKey: pushPublicKey(),
    });
  // Whether a passkey sign-in can succeed at all — so a remote visitor with
  // nothing registered gets told, instead of a prompt that can only fail.
  const anyPasskey = await db.query.passkey.findFirst({
    where: eq(schema.passkey.groupId, group.id),
    columns: { id: true },
  });
  return json({
    needsSetup: false,
    openAccess: isOpenAccess() && !remote,
    remote,
    passkeys: anyPasskey !== undefined,
    homeView: homeView(),
    boxNumbers: boxNumbers(),
    labelPrinting: labelPrintUrl() !== null,
    labelArt: artAvailable(),
    pushPublicKey: pushPublicKey(),
    title: group.landingTitle ?? `${group.name} Inventory Management System`,
    subtitle: group.landingSubtitle ?? "Scan a Box to Start",
  });
}
