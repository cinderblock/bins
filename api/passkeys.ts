/**
 * Passkeys for admin.
 *
 * Two ceremonies, both WebAuthn through @simplewebauthn:
 *
 * - REGISTER (admin already unlocked): the server offers registration
 *   options, the browser creates a credential in the platform's store, the
 *   server verifies and keeps the public key. Reachable at /admin/passkey.
 * - LOGIN (any member device): the server offers the group's credentials as
 *   allowed, the browser signs the challenge with one, the server verifies
 *   and marks THIS device admin for a while (device.admin_until). From then
 *   on /api/admin/* from this device needs no password.
 *
 * Challenges live in memory keyed by device: one process, minutes of life,
 * nothing to persist. The relying-party id is the deployment's hostname
 * (PUBLIC_BASE_URL, or the request's own origin in dev), which is what
 * binds a passkey to this site.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.server";
import { createDevice } from "./auth";
import { publicOrigin } from "./config";
import { type Ctx, error, json } from "./context";

/** How long a passkey login keeps a device unlocked. */
const ADMIN_SESSION_MS = 90 * 24 * 3_600_000;
const CHALLENGE_TTL_MS = 5 * 60_000;

const challenges = new Map<string, { challenge: string; expires: number }>();

function rememberChallenge(key: string, challenge: string) {
  challenges.set(key, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
}

function takeChallenge(key: string): string | null {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}

/** The origin the browser will report, and the rpID derived from it. */
function relyingParty(req: Request): { origin: string; rpID: string } {
  // A browser's fetch carries its Origin; behind the dev proxy that is the
  // truth (the API's own URL is a different port). PUBLIC_BASE_URL wins when
  // set, which is every real deployment.
  const fallback = req.headers.get("origin")?.trim() || new URL(req.url).origin;
  const origin = publicOrigin(fallback);
  return { origin, rpID: new URL(origin).hostname };
}

function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  // Copy into a fresh ArrayBuffer: Buffer's pool-backed view is typed
  // ArrayBufferLike, which the WebAuthn types refuse.
  const buf = Buffer.from(text, "base64url");
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

async function groupPasskeys(groupId: string) {
  return db.query.passkey.findMany({
    where: eq(schema.passkey.groupId, groupId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
}

function passkeyView(row: typeof schema.passkey.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
  };
}

// --- Admin side: register, list, remove ------------------------------------

export async function handlePasskeyRegisterOptions(
  req: Request,
  ctx: Ctx,
  group: { id: string; name: string },
): Promise<Response> {
  const { rpID } = relyingParty(req);
  const existing = await groupPasskeys(group.id);
  const options = await generateRegistrationOptions({
    rpName: `bins — ${group.name}`,
    rpID,
    // One "user" per group: the passkey stands for "an admin of this group".
    userID: new TextEncoder().encode(group.id),
    userName: `admin@${rpID}`,
    userDisplayName: `${group.name} admin`,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.id,
      transports: (p.transports ?? undefined) as
        | AuthenticatorTransport[]
        | undefined,
    })),
    authenticatorSelection: {
      // Discoverable, so a browser with no device yet (an admin reaching in
      // from the internet) can sign in without being handed a credential
      // list — the authenticator finds the passkey by rpID on its own.
      residentKey: "required",
      userVerification: "preferred",
    },
  });
  rememberChallenge(`reg:${ctx.deviceId}`, options.challenge);
  return json({ options });
}

const registerVerifySchema = z.object({
  label: z.string().min(1).max(100),
  response: z.unknown(),
});

export async function handlePasskeyRegisterVerify(
  req: Request,
  ctx: Ctx,
  group: { id: string },
  body: unknown,
): Promise<Response> {
  const parsed = registerVerifySchema.safeParse(body);
  if (!parsed.success) return error(400, "invalid registration");
  const expectedChallenge = takeChallenge(`reg:${ctx.deviceId}`);
  if (!expectedChallenge)
    return error(400, "registration timed out — try again");
  const { origin, rpID } = relyingParty(req);
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return error(400, `passkey not accepted: ${reason}`);
  }
  if (!verification.verified || !verification.registrationInfo)
    return error(400, "passkey not accepted");
  const cred = verification.registrationInfo.credential;
  await db
    .insert(schema.passkey)
    .values({
      id: cred.id,
      groupId: group.id,
      publicKey: toBase64url(cred.publicKey),
      counter: cred.counter,
      transports: cred.transports ?? null,
      label: parsed.data.label.trim(),
      registeredBy: ctx.deviceId,
    })
    .onConflictDoNothing();
  return json({ passkeys: (await groupPasskeys(group.id)).map(passkeyView) });
}

export async function handlePasskeyList(group: {
  id: string;
}): Promise<Response> {
  return json({ passkeys: (await groupPasskeys(group.id)).map(passkeyView) });
}

export async function handlePasskeyRemove(
  group: { id: string },
  body: unknown,
): Promise<Response> {
  const parsed = z.object({ id: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return error(400, "passkey id required");
  await db
    .delete(schema.passkey)
    .where(
      and(
        eq(schema.passkey.groupId, group.id),
        eq(schema.passkey.id, parsed.data.id),
      ),
    );
  return json({ passkeys: (await groupPasskeys(group.id)).map(passkeyView) });
}

// --- Member side: status, login, logout ------------------------------------

/** How many passkeys the caller's group has — whether to offer the button. */
export async function handlePasskeyStatus(ctx: Ctx): Promise<Response> {
  const rows = await groupPasskeys(ctx.groupId);
  return json({
    registered: rows.length,
    adminUntil: ctx.adminUntil,
  });
}

const ANONYMOUS_DEVICE_NAME = "Admin";

/**
 * Start a login. With a device (`ctx`) the options list that group's
 * passkeys; without one — a fresh browser, typically off-site — they list
 * nothing and rely on discoverable passkeys, so the endpoint never
 * enumerates credentials to a stranger. Either way the challenge is filed
 * under a random session id the client hands back at verify time.
 */
export async function handlePasskeyLoginOptions(
  req: Request,
  ctx: Ctx | null,
): Promise<Response> {
  const rows = ctx
    ? await groupPasskeys(ctx.groupId)
    : await db.query.passkey.findMany({ columns: { id: true } });
  if (rows.length === 0) return error(404, "no passkeys registered");
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({
    rpID,
    ...(ctx
      ? {
          allowCredentials: (await groupPasskeys(ctx.groupId)).map((p) => ({
            id: p.id,
            transports: (p.transports ?? undefined) as
              | AuthenticatorTransport[]
              | undefined,
          })),
        }
      : {}),
    userVerification: "preferred",
  });
  const session = crypto.randomUUID();
  rememberChallenge(`auth:${session}`, options.challenge);
  return json({ session, options });
}

const loginVerifySchema = z.object({
  session: z.string().uuid(),
  response: z.unknown(),
  /** Anonymous logins only: what to call the device being minted. */
  displayName: z.string().trim().min(1).max(100).optional(),
  deviceId: z.string().uuid().optional(),
});

/**
 * Finish a login. A joined device becomes admin for ADMIN_SESSION_MS. A
 * browser with no device gets one minted for the passkey's group, already
 * admin, and receives the identity to adopt — the same shape every join
 * returns — so from then on it is an ordinary member device that happens
 * to hold a passkey session.
 */
export async function handlePasskeyLoginVerify(
  req: Request,
  ctx: Ctx | null,
  body: unknown,
): Promise<Response> {
  const parsed = loginVerifySchema.safeParse(body);
  if (!parsed.success) return error(400, "invalid login");
  const response = parsed.data.response as AuthenticationResponseJSON;
  const expectedChallenge = takeChallenge(`auth:${parsed.data.session}`);
  if (!expectedChallenge) return error(400, "login timed out — try again");
  const row = await db.query.passkey.findFirst({
    where: eq(schema.passkey.id, response?.id ?? ""),
  });
  // A joined device may only use its own group's passkeys — a passkey from
  // another tenant must not make it admin here.
  if (!row || (ctx && row.groupId !== ctx.groupId))
    return error(403, "unknown passkey");
  const { origin, rpID } = relyingParty(req);
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: row.id,
        publicKey: fromBase64url(row.publicKey),
        counter: row.counter,
        transports: (row.transports ?? undefined) as
          | AuthenticatorTransport[]
          | undefined,
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return error(403, `passkey not accepted: ${reason}`);
  }
  if (!verification.verified) return error(403, "passkey not accepted");

  const now = new Date();
  await db
    .update(schema.passkey)
    .set({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: now,
    })
    .where(eq(schema.passkey.id, row.id));
  const adminUntil = new Date(now.getTime() + ADMIN_SESSION_MS);

  if (ctx) {
    await db
      .update(schema.device)
      .set({ adminUntil })
      .where(eq(schema.device.id, ctx.deviceId));
    return json({ ok: true, adminUntil: adminUntil.getTime() });
  }

  const group = await db.query.group.findFirst({
    where: eq(schema.group.id, row.groupId),
    columns: { id: true, name: true },
  });
  if (!group) return error(403, "unknown passkey");
  const identity = await createDevice(
    group,
    parsed.data.displayName ?? ANONYMOUS_DEVICE_NAME,
    parsed.data.deviceId ?? crypto.randomUUID(),
    { adminUntil },
  );
  if (!identity) return error(409, "device id already registered");
  return json({ ok: true, adminUntil: adminUntil.getTime(), identity });
}

/** Lock: this device is no longer admin, whatever unlocked it. */
export async function handlePasskeyLogout(ctx: Ctx): Promise<Response> {
  await db
    .update(schema.device)
    .set({ adminUntil: null })
    .where(eq(schema.device.id, ctx.deviceId));
  return json({ ok: true });
}
