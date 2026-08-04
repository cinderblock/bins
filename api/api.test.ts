/**
 * API integration test: the whole loop a phone performs — first-boot setup,
 * join with the access code, allocate stickers, claim + annotate a bin, pull
 * from a second device, admin config/import, upload/fetch a photo blob —
 * against a throwaway SQLite db.
 */
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, "..", "data", "test");
process.env.DATABASE_PATH = join(TEST_DIR, "api-test.db");
process.env.PHOTOS_PATH = join(TEST_DIR, "photos");
rmSync(TEST_DIR, { recursive: true, force: true });

// Imported dynamically so the env above is read first.
const { handleApi } = await import("./router");
const { db, schema } = await import("../db/client.server");
const { sha256Hex } = await import("./context");

const BASE = "http://localhost";

function call(
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    rawBody?: Uint8Array;
    mime?: string;
    origin?: string;
    /** Simulates what a reverse proxy would set (see api/config.ts). */
    xff?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.Origin = opts.origin;
  if (opts.xff) headers["X-Forwarded-For"] = opts.xff;
  let body: BodyInit | undefined;
  if (opts.rawBody) {
    body = opts.rawBody as unknown as BodyInit;
    headers["Content-Type"] = opts.mime ?? "application/octet-stream";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  const url = new URL(`${BASE}${path}`);
  return handleApi(new Request(url, { method, headers, body }), url);
}

let uuidN = 0;
const uuid = () =>
  `00000000-0000-7000-8000-${String(uuidN++).padStart(12, "0")}`;

let tokenA: string;
let tokenB: string;
let binId: number;
let allocated: { id: number; code: string }[];

describe("api", () => {
  test("first boot: landing → setup wizard → branded landing; then locked", async () => {
    const before = (await (await call("GET", "/api/landing")).json()) as {
      needsSetup: boolean;
    };
    expect(before.needsSetup).toBe(true);

    const setupBody = {
      groupName: "Test Camp",
      accessCode: "secret-code",
      adminPassword: "admin-pw",
      displayName: "Ops",
      deviceId: crypto.randomUUID(),
    };
    const setup = await call("POST", "/api/setup", { body: setupBody });
    expect(setup.status).toBe(200);
    const identity = (await setup.json()) as {
      token: string;
      groupName: string;
    };
    expect(identity.groupName).toBe("Test Camp");
    // The operator is a full member immediately (auto-join).
    const me = await call("GET", "/api/auth/me", { token: identity.token });
    expect(me.status).toBe(200);

    const after = (await (await call("GET", "/api/landing")).json()) as {
      needsSetup: boolean;
      title: string;
      subtitle: string;
    };
    expect(after.needsSetup).toBe(false);
    expect(after.title).toBe("Test Camp Inventory Management System");
    expect(after.subtitle).toBe("Scan a Box to Start");

    // Setup is one-shot: a second call must never create another group.
    const again = await call("POST", "/api/setup", {
      body: { ...setupBody, deviceId: crypto.randomUUID() },
    });
    expect(again.status).toBe(403);
  });

  test("join with access code (both devices)", async () => {
    const resA = await call("POST", "/api/auth/join", {
      body: {
        accessCode: " Secret-Code ",
        displayName: "Ada",
        deviceId: crypto.randomUUID(),
      },
    });
    expect(resA.status).toBe(200);
    tokenA = ((await resA.json()) as { token: string }).token;

    const resB = await call("POST", "/api/auth/join", {
      body: {
        accessCode: "secret-code",
        displayName: "Bob",
        deviceId: crypto.randomUUID(),
      },
    });
    tokenB = ((await resB.json()) as { token: string }).token;
    expect(tokenB).not.toBe(tokenA);
  });

  test("bad access code rejected; missing token unauthorized", async () => {
    const bad = await call("POST", "/api/auth/join", {
      body: {
        accessCode: "nope",
        displayName: "Eve",
        deviceId: crypto.randomUUID(),
      },
    });
    expect(bad.status).toBe(403);
    const noAuth = await call("GET", "/api/sync/pull?since=0");
    expect(noAuth.status).toBe(401);
  });

  test("allocate stickers, claim + note, second device converges via pull", async () => {
    // Allocation is admin-only: a member token without the admin password
    // can't reserve sticker IDs.
    const denied = await call("POST", "/api/admin/bins/allocate", {
      token: tokenA,
      body: { count: 3 },
    });
    expect(denied.status).toBe(400);
    const wrongPw = await call("POST", "/api/admin/bins/allocate", {
      token: tokenA,
      body: { adminPassword: "nope", count: 3 },
    });
    expect(wrongPw.status).toBe(403);

    const alloc = await call("POST", "/api/admin/bins/allocate", {
      token: tokenA,
      body: { adminPassword: "admin-pw", count: 3 },
    });
    expect(alloc.status).toBe(200);
    allocated = ((await alloc.json()) as { bins: typeof allocated }).bins;
    expect(allocated).toHaveLength(3);
    expect(Math.min(...allocated.map((b) => b.id))).toBeGreaterThanOrEqual(10);
    // Every sticker gets a secret from the confusable-free alphabet.
    for (const { code } of allocated) {
      expect(code).toMatch(/^[0-9ABCDEFGHJKMNPRSTUVWXYZ]{4}$/);
    }
    binId = (allocated[0] as { id: number }).id;

    const push = await call("POST", "/api/sync/push", {
      token: tokenA,
      body: {
        ops: [
          {
            opId: uuid(),
            type: "bin.claim",
            binId,
            payload: { name: "Kitchen", sizeClass: "M" },
            clientTime: Date.now(),
          },
          {
            opId: uuid(),
            type: "entry.addNote",
            binId,
            payload: { text: "3 tarps, rope" },
            clientTime: Date.now(),
            geo: { lat: 40.786, lng: -119.206, acc: 10 },
          },
        ],
      },
    });
    expect(push.status).toBe(200);
    const pushBody = (await push.json()) as {
      acks: unknown[];
      rejected: unknown[];
    };
    expect(pushBody.acks).toHaveLength(2);
    expect(pushBody.rejected).toHaveLength(0);

    // Device B pulls everything: 3 allocations + claim + note.
    const pull = await call("GET", "/api/sync/pull?since=0", { token: tokenB });
    const pullBody = (await pull.json()) as {
      ops: { type: string; binId?: number; payload?: { code?: string } }[];
      hasMore: boolean;
    };
    expect(pullBody.ops).toHaveLength(5);
    const allocOps = pullBody.ops.filter((o) => o.type === "bin.allocate");
    expect(allocOps).toHaveLength(3);
    // The sticker secrets ride the ops into every replica.
    expect(allocOps.map((o) => o.payload?.code).sort()).toEqual(
      allocated.map((b) => b.code).sort(),
    );
    expect(pullBody.hasMore).toBe(false);

    // Server materialized the claim.
    const { eq } = await import("drizzle-orm");
    const bin = await db.query.bin.findFirst({
      where: eq(schema.bin.id, binId),
    });
    expect(bin?.status).toBe("active");
    expect(bin?.name).toBe("Kitchen");
  });

  test("retire/restore is admin-only and flips bin status", async () => {
    const { eq } = await import("drizzle-orm");
    const statusOf = async () =>
      (await db.query.bin.findFirst({ where: eq(schema.bin.id, binId) }))
        ?.status;

    // Member token, no admin password — rejected before anything changes.
    const denied = await call("POST", "/api/admin/bins/retire", {
      token: tokenA,
      body: { binId },
    });
    expect(denied.status).toBe(400);
    expect(await statusOf()).toBe("active");

    const retire = await call("POST", "/api/admin/bins/retire", {
      token: tokenA,
      body: { adminPassword: "admin-pw", binId },
    });
    expect(retire.status).toBe(200);
    expect(await statusOf()).toBe("retired");

    const restore = await call("POST", "/api/admin/bins/restore", {
      token: tokenA,
      body: { adminPassword: "admin-pw", binId },
    });
    expect(restore.status).toBe(200);
    expect(await statusOf()).toBe("active");

    // A bin outside the group (here: nonexistent) is a 404, not a silent stub.
    const missing = await call("POST", "/api/admin/bins/retire", {
      token: tokenA,
      body: { adminPassword: "admin-pw", binId: 999_999 },
    });
    expect(missing.status).toBe(404);
  });

  test("a deleted photo can be undone, and the undo reaches other devices", async () => {
    const { eq } = await import("drizzle-orm");
    const hash = "b".repeat(64);
    const photoOpId = uuid();
    // Strictly increasing so the LWW verdict order is the one under test and
    // not a same-millisecond opId tiebreak.
    const t0 = Date.now();
    const primaryHash = async () =>
      (await db.query.bin.findFirst({ where: eq(schema.bin.id, binId) }))
        ?.primaryPhotoHash;
    const v1EntryIds = async () => {
      const res = await call("GET", `/api/v1/bins/${binId}`, { token: tokenA });
      const body = (await res.json()) as { entries: { id: string }[] };
      return body.entries.map((e) => e.id);
    };

    const add = await call("POST", "/api/sync/push", {
      token: tokenA,
      body: {
        ops: [
          {
            opId: photoOpId,
            type: "entry.addPhoto",
            binId,
            payload: { hash, kind: "contents_photo", mime: "image/jpeg" },
            clientTime: t0,
          },
        ],
      },
    });
    expect(add.status).toBe(200);
    expect(await primaryHash()).toBe(hash);
    expect(await v1EntryIds()).toContain(photoOpId);

    // Device B deletes it — the derived primary falls away with it.
    const remove = await call("POST", "/api/sync/push", {
      token: tokenB,
      body: {
        ops: [
          {
            opId: uuid(),
            type: "entry.remove",
            binId,
            payload: { entryOpId: photoOpId },
            clientTime: t0 + 1,
          },
        ],
      },
    });
    expect(remove.status).toBe(200);
    expect(await primaryHash()).toBeNull();
    expect(await v1EntryIds()).not.toContain(photoOpId);

    // Device A — which did NOT delete it — undoes the delete.
    const restore = await call("POST", "/api/sync/push", {
      token: tokenA,
      body: {
        ops: [
          {
            opId: uuid(),
            type: "entry.restore",
            binId,
            payload: { entryOpId: photoOpId },
            clientTime: t0 + 2,
          },
        ],
      },
    });
    expect(restore.status).toBe(200);
    expect(await primaryHash()).toBe(hash);
    expect(await v1EntryIds()).toContain(photoOpId);

    // The tombstone is cleared on the row, and the restore is a real op every
    // other device pulls — not a local un-hide.
    const entry = await db.query.binEntry.findFirst({
      where: eq(schema.binEntry.id, photoOpId),
    });
    expect(entry?.deletedByOpId).toBeNull();
    expect(entry?.deletedClock).toBeTruthy();

    const pull = await call("GET", "/api/sync/pull?since=0", { token: tokenB });
    const pulled = (await pull.json()) as { ops: { type: string }[] };
    expect(pulled.ops.map((o) => o.type)).toContain("entry.restore");
  });

  test("secret codes fold look-alike glyphs when read", async () => {
    const { normalizeSecretCode } = await import("../shared/ops");
    // O/Q → 0, I/L → 1; case- and whitespace-insensitive.
    expect(normalizeSecretCode("o1lq")).toBe("0110");
    expect(normalizeSecretCode(" ab0 ")).toBe("AB0");
    // Idempotent on codes already drawn from the alphabet.
    expect(normalizeSecretCode("7HX0")).toBe("7HX0");
  });

  test("labels + weight: pushed ops materialize on the server and pull", async () => {
    const { eq } = await import("drizzle-orm");
    const boozeId = crypto.randomUUID();
    const liquidId = crypto.randomUUID();
    const push = await call("POST", "/api/sync/push", {
      token: tokenA,
      body: {
        ops: [
          {
            opId: uuid(),
            type: "label.upsert",
            payload: {
              labelId: boozeId,
              name: "booze",
              color: "grape",
              sortOrder: 1,
            },
            clientTime: Date.now(),
          },
          {
            opId: uuid(),
            type: "label.upsert",
            payload: { labelId: liquidId, name: "liquid", sortOrder: 2 },
            clientTime: Date.now(),
          },
          {
            opId: uuid(),
            type: "bin.setLabel",
            binId,
            payload: { labelId: boozeId, present: true },
            clientTime: Date.now(),
          },
          {
            opId: uuid(),
            type: "bin.setLabel",
            binId,
            payload: { labelId: liquidId, present: true },
            clientTime: Date.now(),
          },
          {
            opId: uuid(),
            type: "bin.setFields",
            binId,
            payload: { weightGrams: 12000 },
            clientTime: Date.now(),
          },
        ],
      },
    });
    expect(push.status).toBe(200);
    const pushBody = (await push.json()) as {
      acks: unknown[];
      rejected: unknown[];
    };
    expect(pushBody.acks).toHaveLength(5);
    expect(pushBody.rejected).toHaveLength(0);

    // Server materialized the label rows, the bin membership, and the weight.
    const label = await db.query.label.findFirst({
      where: eq(schema.label.id, boozeId),
    });
    expect(label?.name).toBe("booze");
    expect(label?.color).toBe("grape");
    const bin = await db.query.bin.findFirst({
      where: eq(schema.bin.id, binId),
    });
    expect(bin?.weightGrams).toBe(12000);
    expect([...(bin?.labelIds ?? [])].sort()).toEqual(
      [boozeId, liquidId].sort(),
    );

    // A second device pulls the label + membership ops through normal sync.
    const pull = await call("GET", "/api/sync/pull?since=0", { token: tokenB });
    const pullBody = (await pull.json()) as { ops: { type: string }[] };
    expect(pullBody.ops.some((o) => o.type === "label.upsert")).toBe(true);
    expect(pullBody.ops.some((o) => o.type === "bin.setLabel")).toBe(true);
  });

  test("revoked device can re-join with the SAME deviceId (sign-back-in)", async () => {
    const deviceId = crypto.randomUUID();
    const first = await call("POST", "/api/auth/join", {
      body: { accessCode: "secret-code", displayName: "Rex", deviceId },
    });
    expect(first.status).toBe(200);
    const oldToken = ((await first.json()) as { token: string }).token;

    // Live device id must never be adoptable…
    const dupe = await call("POST", "/api/auth/join", {
      body: { accessCode: "secret-code", displayName: "Mallory", deviceId },
    });
    expect(dupe.status).toBe(409);

    // …but once revoked (row deleted), the same id re-registers, keeping
    // authorship continuity for the client's sign-back-in flow.
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.device).where(eq(schema.device.id, deviceId));
    const denied = await call("GET", "/api/auth/me", { token: oldToken });
    expect(denied.status).toBe(401);

    const rejoin = await call("POST", "/api/auth/join", {
      body: { accessCode: "secret-code", displayName: "Rex", deviceId },
    });
    expect(rejoin.status).toBe(200);
    const fresh = (await rejoin.json()) as { token: string; deviceId: string };
    expect(fresh.deviceId).toBe(deviceId);
    expect(fresh.token).not.toBe(oldToken);
    const me = await call("GET", "/api/auth/me", { token: fresh.token });
    expect(me.status).toBe(200);
  });

  test("join-by-bin: sticker pair joins (even unclaimed); bare id never does", async () => {
    // Happy path on an UNCLAIMED bin, with the code typed in the wrong case.
    const fresh = allocated[2] as { id: number; code: string };
    const res = await call("POST", "/api/auth/join-by-bin", {
      body: {
        binId: fresh.id,
        code: fresh.code.toLowerCase(),
        displayName: "Cleo",
        deviceId: crypto.randomUUID(),
      },
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };

    // The minted token is a full member token.
    const me = await call("GET", "/api/auth/me", { token });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { displayName: string };
    expect(meBody.displayName).toBe("Cleo");

    // Wrong code and unknown bin fail identically ("0" is not in the
    // code alphabet, so this can never accidentally match).
    for (const body of [
      { binId: fresh.id, code: "0000" },
      { binId: 99999, code: fresh.code },
    ]) {
      const denied = await call("POST", "/api/auth/join-by-bin", {
        body: {
          ...body,
          displayName: "Mallory",
          deviceId: crypto.randomUUID(),
        },
      });
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: string }).error).toBe(
        "unknown bin or code",
      );
    }

    // A bare bin number — no code, or an empty one — can't even ask.
    for (const code of [undefined, ""]) {
      const bare = await call("POST", "/api/auth/join-by-bin", {
        body: {
          binId: fresh.id,
          code,
          displayName: "Mallory",
          deviceId: crypto.randomUUID(),
        },
      });
      expect(bare.status).toBe(400);
    }
  });

  test("admin: password-gated config, branding, import; revoke kills tokens", async () => {
    const wrong = await call("POST", "/api/admin/verify", {
      token: tokenA,
      body: { adminPassword: "nope" },
    });
    expect(wrong.status).toBe(403);

    const verify = await call("POST", "/api/admin/verify", {
      token: tokenA,
      body: { adminPassword: "admin-pw" },
    });
    expect(verify.status).toBe(200);

    // Branding edits show up on the public landing.
    const patch = await call("POST", "/api/admin/group", {
      token: tokenA,
      body: {
        adminPassword: "admin-pw",
        landingTitle: "Camp Stuff",
        landingSubtitle: "Point at a box",
      },
    });
    expect(patch.status).toBe(200);
    const landing = (await (await call("GET", "/api/landing")).json()) as {
      title: string;
      subtitle: string;
    };
    expect(landing.title).toBe("Camp Stuff");
    expect(landing.subtitle).toBe("Point at a box");

    // Import pre-printed stickers: collisions skipped, imports usable — the
    // imported (id, code) pair is a working sticker login.
    const imp = await call("POST", "/api/admin/bins/import", {
      token: tokenA,
      body: {
        adminPassword: "admin-pw",
        bins: [
          { id: 5001, code: "ZZZZ" },
          { id: binId, code: "AAAA" },
        ],
      },
    });
    const impBody = (await imp.json()) as {
      imported: number;
      skipped: { id: number }[];
    };
    expect(impBody.imported).toBe(1);
    expect(impBody.skipped.map((s) => s.id)).toEqual([binId]);

    const joined = await call("POST", "/api/auth/join-by-bin", {
      body: {
        binId: 5001,
        code: "zzzz",
        displayName: "Imported Ivy",
        deviceId: crypto.randomUUID(),
      },
    });
    expect(joined.status).toBe(200);
    const ivyToken = ((await joined.json()) as { token: string }).token;

    // Devices list shows the member; revoking kills the token.
    const list = await call("POST", "/api/admin/devices", {
      token: tokenA,
      body: { adminPassword: "admin-pw" },
    });
    const { devices } = (await list.json()) as {
      devices: { id: string; displayName: string; self: boolean }[];
    };
    const ivy = devices.find((d) => d.displayName === "Imported Ivy");
    expect(ivy).toBeDefined();
    const revoke = await call("POST", "/api/admin/devices/revoke", {
      token: tokenA,
      body: { adminPassword: "admin-pw", deviceId: ivy?.id },
    });
    expect(revoke.status).toBe(200);
    const dead = await call("GET", "/api/auth/me", { token: ivyToken });
    expect(dead.status).toBe(401);
  });

  test("push is idempotent (same opId re-acked, not re-applied)", async () => {
    const opId = uuid();
    const op = {
      opId,
      type: "bin.setLocation",
      binId,
      payload: { locationName: "Trailer" },
      clientTime: Date.now(),
    };
    const first = await call("POST", "/api/sync/push", {
      token: tokenA,
      body: { ops: [op] },
    });
    const firstAck = ((await first.json()) as { acks: { seq: number }[] })
      .acks[0];
    const second = await call("POST", "/api/sync/push", {
      token: tokenA,
      body: { ops: [op] },
    });
    const secondAck = ((await second.json()) as { acks: { seq: number }[] })
      .acks[0];
    expect(secondAck?.seq).toBe(firstAck?.seq as number);
  });

  test("ops against unknown bins are rejected, not stored", async () => {
    const push = await call("POST", "/api/sync/push", {
      token: tokenA,
      body: {
        ops: [
          {
            opId: uuid(),
            type: "entry.addNote",
            binId: 99999,
            payload: { text: "sneaky" },
            clientTime: Date.now(),
          },
        ],
      },
    });
    const body = (await push.json()) as {
      acks: unknown[];
      rejected: { error: string }[];
    };
    expect(body.acks).toHaveLength(0);
    expect(body.rejected[0]?.error).toBe("unknown bin");
  });

  test("blob upload roundtrip: hash-verified, retry-free, group-scoped", async () => {
    const bytes = new TextEncoder().encode(
      "not really a jpeg but bytes are bytes",
    );
    const hash = sha256Hex(bytes);

    const wrongHash = await call("PUT", `/api/blobs/${"0".repeat(64)}`, {
      token: tokenA,
      rawBody: bytes,
      mime: "image/jpeg",
    });
    expect(wrongHash.status).toBe(400);

    const put = await call("PUT", `/api/blobs/${hash}`, {
      token: tokenA,
      rawBody: bytes,
      mime: "image/jpeg",
    });
    expect(put.status).toBe(200);

    // Retry is free.
    const rePut = await call("PUT", `/api/blobs/${hash}`, {
      token: tokenA,
      rawBody: bytes,
      mime: "image/jpeg",
    });
    expect(rePut.status).toBe(200);

    const get = await call("GET", `/api/blobs/${hash}`, { token: tokenB });
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
  });

  // --- Integration tokens + public API ------------------------------------

  const ALLOWED_ORIGIN = "https://app.example.com";
  let readToken: string;
  let writeToken: string;
  let writeIntegrationId: string;

  test("admin mints scoped integration tokens (shown once, hash-only stored)", async () => {
    const mk = (body: Record<string, unknown>) =>
      call("POST", "/api/admin/integrations/create", {
        token: tokenA,
        body: { adminPassword: "admin-pw", ...body },
      });

    const read = await mk({ label: "Dashboard", scope: "read" });
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as {
      token: string;
      integration: { id: string; scope: string; tokenPrefix: string };
    };
    readToken = readBody.token;
    expect(readToken).toMatch(/^bins_[0-9a-f]{8}_[0-9a-f]{64}$/);
    expect(readBody.integration.scope).toBe("read");
    // The stored prefix identifies the token we only otherwise see hashed.
    expect(readToken).toContain(readBody.integration.tokenPrefix);

    const write = await mk({
      label: "Importer",
      scope: "write",
      allowedOrigins: [ALLOWED_ORIGIN],
    });
    const writeBody = (await write.json()) as {
      token: string;
      integration: { id: string };
    };
    writeToken = writeBody.token;
    writeIntegrationId = writeBody.integration.id;

    // A wildcard CORS origin is indefensible for a write token.
    const badWildcard = await mk({
      label: "Nope",
      scope: "write",
      allowedOrigins: ["*"],
    });
    expect(badWildcard.status).toBe(400);

    // Listed with scope + prefix, never exposing a token or its hash.
    const list = await call("POST", "/api/admin/integrations", {
      token: tokenA,
      body: { adminPassword: "admin-pw" },
    });
    const { integrations } = (await list.json()) as {
      integrations: Record<string, unknown>[];
    };
    expect(integrations.map((i) => i.label).sort()).toEqual([
      "Dashboard",
      "Importer",
    ]);
    for (const i of integrations) {
      expect(i).not.toHaveProperty("token");
      expect(i).not.toHaveProperty("tokenHash");
    }

    // Integrations never appear in the human device list.
    const devices = await call("POST", "/api/admin/devices", {
      token: tokenA,
      body: { adminPassword: "admin-pw" },
    });
    const { devices: rows } = (await devices.json()) as {
      devices: { displayName: string }[];
    };
    expect(rows.some((d) => d.displayName === "Dashboard")).toBe(false);
  });

  test("read token reads /api/v1 but cannot write (and never sees secretCode)", async () => {
    const bins = await call("GET", "/api/v1/bins", { token: readToken });
    expect(bins.status).toBe(200);
    const binsBody = (await bins.json()) as {
      bins: Record<string, unknown>[];
    };
    const ours = binsBody.bins.find((b) => b.id === binId);
    expect(ours).toBeDefined();
    // The sticker secret must never ride the public read surface.
    for (const b of binsBody.bins) expect(b).not.toHaveProperty("secretCode");

    const one = await call("GET", `/api/v1/bins/${binId}`, {
      token: readToken,
    });
    const oneBody = (await one.json()) as {
      bin: Record<string, unknown>;
      entries: { kind: string; text: string | null; author: string | null }[];
    };
    expect(oneBody.bin).not.toHaveProperty("secretCode");
    const note = oneBody.entries.find((e) => e.kind === "note");
    expect(note?.text).toBe("3 tarps, rope");
    expect(note?.author).toBe("Ada"); // authorship resolves to a display name

    expect(
      (await call("GET", "/api/v1/locations", { token: readToken })).status,
    ).toBe(200);

    // Read scope is read-only: push, blob PUT, and admin are all refused.
    const push = await call("POST", "/api/sync/push", {
      token: readToken,
      body: { ops: [] },
    });
    expect(push.status).toBe(403);
    const put = await call("PUT", `/api/blobs/${"0".repeat(64)}`, {
      token: readToken,
      rawBody: new TextEncoder().encode("x"),
    });
    expect(put.status).toBe(403);
    const admin = await call("POST", "/api/admin/verify", {
      token: readToken,
      body: { adminPassword: "admin-pw" },
    });
    expect(admin.status).toBe(403); // members only, before the password check
  });

  test("write token authors ops through the reducer, attributed to the integration", async () => {
    const push = await call("POST", "/api/sync/push", {
      token: writeToken,
      body: {
        ops: [
          {
            opId: uuid(),
            type: "entry.addNote",
            binId,
            payload: { text: "from the importer" },
            clientTime: Date.now(),
          },
        ],
      },
    });
    expect(push.status).toBe(200);
    expect(((await push.json()) as { acks: unknown[] }).acks).toHaveLength(1);

    // The note surfaces on the read API attributed to the integration's label.
    const one = await call("GET", `/api/v1/bins/${binId}`, {
      token: readToken,
    });
    const { entries } = (await one.json()) as {
      entries: { text: string | null; author: string | null }[];
    };
    const mine = entries.find((e) => e.text === "from the importer");
    expect(mine?.author).toBe("Importer");
  });

  test("CORS: preflight + real response honor the per-token origin allowlist", async () => {
    // Preflight (no auth) is allowed because an integration lists the origin.
    const pre = await call("OPTIONS", "/api/v1/bins", {
      origin: ALLOWED_ORIGIN,
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);

    // The real response echoes the origin for the token that lists it…
    const ok = await call("GET", "/api/v1/bins", {
      token: writeToken,
      origin: ALLOWED_ORIGIN,
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);

    // …but an unlisted origin gets no CORS headers (browser blocks the read),
    const blocked = await call("GET", "/api/v1/bins", {
      token: writeToken,
      origin: "https://evil.example.com",
    });
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
    // …and a token with no allowlist (the read token) never gets them either.
    const noList = await call("GET", "/api/v1/bins", {
      token: readToken,
      origin: ALLOWED_ORIGIN,
    });
    expect(noList.headers.get("access-control-allow-origin")).toBeNull();

    const preBlocked = await call("OPTIONS", "/api/v1/bins", {
      origin: "https://evil.example.com",
    });
    expect(preBlocked.status).toBe(204);
    expect(preBlocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("revoking an integration kills its token immediately", async () => {
    const revoke = await call("POST", "/api/admin/integrations/revoke", {
      token: tokenA,
      body: { adminPassword: "admin-pw", integrationId: writeIntegrationId },
    });
    expect(revoke.status).toBe(200);
    const dead = await call("GET", "/api/v1/bins", { token: writeToken });
    expect(dead.status).toBe(401);
  });
});

/**
 * OPEN_ACCESS: a deployment that declares itself perimeter-protected. The env
 * is restored after every test so the flag can never leak into the suite
 * above — which is the whole reason api/config.ts reads it per call.
 */
describe("open access", () => {
  function withOpenAccess<T>(
    env: { requirePrivate?: boolean },
    fn: () => Promise<T>,
  ): Promise<T> {
    process.env.OPEN_ACCESS = "1";
    if (env.requirePrivate === false)
      process.env.OPEN_ACCESS_REQUIRE_PRIVATE_CLIENT = "0";
    return fn().finally(() => {
      // `delete`, not `= undefined` — assigning undefined to process.env
      // stores the STRING "undefined", which is not the same as unset and
      // silently disabled the private-client backstop when this was written.
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.OPEN_ACCESS;
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.OPEN_ACCESS_REQUIRE_PRIVATE_CLIENT;
    });
  }

  test("the endpoint does not exist on a closed deployment", async () => {
    const res = await call("POST", "/api/auth/join-open", {
      body: { displayName: "Nobody", deviceId: crypto.randomUUID() },
      xff: "10.0.0.5",
    });
    // 404, not 403: a closed deployment doesn't advertise the route at all.
    expect(res.status).toBe(404);
  });

  test("landing advertises the mode so the SPA can pick its gate", async () => {
    const closed = (await (await call("GET", "/api/landing")).json()) as {
      openAccess: boolean;
    };
    expect(closed.openAccess).toBe(false);

    const open = await withOpenAccess({}, async () => {
      return (await (await call("GET", "/api/landing")).json()) as {
        openAccess: boolean;
      };
    });
    expect(open.openAccess).toBe(true);
  });

  test("home view is advertised and defaults to the scanner", async () => {
    const def = (await (await call("GET", "/api/landing")).json()) as {
      homeView: string;
    };
    // Unset must stay the historical behavior — a camera-first home.
    expect(def.homeView).toBe("scanner");

    process.env.HOME_VIEW = "browse";
    try {
      const browse = (await (await call("GET", "/api/landing")).json()) as {
        homeView: string;
      };
      expect(browse.homeView).toBe("browse");
    } finally {
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.HOME_VIEW;
    }

    // Independent of the trust model: a perimeter says nothing about whether
    // you want a camera or a list first.
    const openStillScanner = await withOpenAccess({}, async () => {
      return (await (await call("GET", "/api/landing")).json()) as {
        homeView: string;
        openAccess: boolean;
      };
    });
    expect(openStillScanner.openAccess).toBe(true);
    expect(openStillScanner.homeView).toBe("scanner");
  });

  test("box numbers can be marked internal without touching ids", async () => {
    const def = (await (await call("GET", "/api/landing")).json()) as {
      boxNumbers: string;
    };
    expect(def.boxNumbers).toBe("public");

    process.env.BOX_NUMBERS = "internal";
    try {
      const internal = (await (await call("GET", "/api/landing")).json()) as {
        boxNumbers: string;
      };
      expect(internal.boxNumbers).toBe("internal");

      // Presentation only: ids stay integers from the one monotonic sequence,
      // because THAT is what guarantees a retired sticker is never reissued.
      const res = await call("POST", "/api/admin/bins/allocate", {
        token: tokenA,
        body: { adminPassword: "admin-pw", count: 2 },
      });
      const body = (await res.json()) as { bins: { id: number }[] };
      const ids = body.bins.map((b) => b.id);
      expect(ids.every((id) => Number.isInteger(id))).toBe(true);
      expect(ids[1]).toBe((ids[0] ?? 0) + 1);
      // And strictly above every id handed out earlier in this suite.
      expect(ids[0]).toBeGreaterThan(binId);
    } finally {
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.BOX_NUMBERS;
    }
  });

  test("label printing is off unless a printer URL is configured", async () => {
    const landing = (await (await call("GET", "/api/landing")).json()) as {
      labelPrinting: boolean;
    };
    expect(landing.labelPrinting).toBe(false);

    // The endpoint refuses rather than pretending to print.
    const off = await call("POST", "/api/admin/bins/label", {
      token: tokenA,
      body: { adminPassword: "admin-pw", binId },
    });
    expect(off.status).toBe(501);
  });

  test("label print posts a rendered PNG, not a spec", async () => {
    const seen: {
      url: string;
      contentType: string | null;
      body: Uint8Array;
    }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      seen.push({
        url: String(input),
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body as Uint8Array,
      });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    process.env.LABEL_PRINT_URL = "http://labelpi.test/print";
    process.env.PUBLIC_BASE_URL = "https://store.example.org";

    try {
      const res = await call("POST", "/api/admin/bins/label", {
        token: tokenA,
        body: { adminPassword: "admin-pw", binId, copies: 2 },
      });
      expect(res.status).toBe(200);
      // One request per copy: a printer is one physical device, and firing
      // them concurrently tends to interleave or drop jobs.
      expect(seen).toHaveLength(2);
      const first = seen[0];
      expect(first?.contentType).toBe("image/png");
      // Pixels, not JSON — the printer needs no knowledge of what a bin is.
      const png = first?.body as Uint8Array;
      expect(png.byteLength).toBeGreaterThan(1000);
      // PNG magic number.
      expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } finally {
      globalThis.fetch = realFetch;
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.LABEL_PRINT_URL;
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  test("preview returns the same image without printing", async () => {
    let printed = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      printed++;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    process.env.LABEL_PRINT_URL = "http://labelpi.test/print";
    try {
      const res = await call("POST", "/api/admin/bins/label/preview", {
        token: tokenA,
        body: { adminPassword: "admin-pw", binId },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      // Nothing reached the printer — that's the entire point of a preview.
      expect(printed).toBe(0);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    } finally {
      globalThis.fetch = realFetch;
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.LABEL_PRINT_URL;
    }
  });

  test("asking for art without a provider refuses instead of printing plain", async () => {
    process.env.LABEL_PRINT_URL = "http://labelpi.test/print";
    try {
      const res = await call("POST", "/api/admin/bins/label", {
        token: tokenA,
        body: { adminPassword: "admin-pw", binId, art: true },
      });
      // Silently printing an art-less label would waste stock on something
      // the user didn't ask for.
      expect(res.status).toBe(501);
    } finally {
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.LABEL_PRINT_URL;
    }
  });

  test("a printer error is reported, not swallowed", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("out of paper", { status: 503 })) as unknown as typeof fetch;
    process.env.LABEL_PRINT_URL = "http://labelpi.test/api/label";
    try {
      const res = await call("POST", "/api/admin/bins/label", {
        token: tokenA,
        body: { adminPassword: "admin-pw", binId },
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      // The printer's own words reach the person holding the box.
      expect(body.error).toContain("out of paper");
    } finally {
      globalThis.fetch = realFetch;
      // biome-ignore lint/performance/noDelete: unsetting an env var needs it
      delete process.env.LABEL_PRINT_URL;
    }
  });

  test("landing says needsSetup so a fresh open server can reach /setup", async () => {
    // Regression: the shell's open-access branch offers a name-only join
    // card, and on a database with no group that join can only fail with
    // "not set up yet". The client routes on needsSetup to avoid that dead
    // end, so the flag has to be present alongside openAccess.
    const body = await withOpenAccess({}, async () => {
      return (await (await call("GET", "/api/landing")).json()) as {
        needsSetup: boolean;
        openAccess: boolean;
      };
    });
    expect(body.openAccess).toBe(true);
    expect(typeof body.needsSetup).toBe("boolean");
  });

  test("join-open re-registers a device the server has forgotten", async () => {
    // A revoked device (or one whose database was rebuilt) has no access code
    // to offer on this kind of deployment — none exists. Re-joining by name
    // is the only way back, so it must work for an already-known name.
    const identity = await withOpenAccess({}, async () => {
      const res = await call("POST", "/api/auth/join-open", {
        body: {
          displayName: "Reconnecting iPad",
          deviceId: crypto.randomUUID(),
        },
        xff: "10.0.0.9",
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { token: string };
    });
    const me = await call("GET", "/api/auth/me", { token: identity.token });
    expect(me.status).toBe(200);
  });

  test("a private client joins with only a name", async () => {
    const identity = await withOpenAccess({}, async () => {
      const res = await call("POST", "/api/auth/join-open", {
        body: { displayName: "Warehouse iPad", deviceId: crypto.randomUUID() },
        xff: "10.0.0.5",
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { token: string; displayName: string };
    });
    expect(identity.displayName).toBe("Warehouse iPad");

    // The minted token is a normal member token.
    const me = await call("GET", "/api/auth/me", { token: identity.token });
    expect(me.status).toBe(200);
  });

  test("a public client is refused even with the flag on", async () => {
    const res = await withOpenAccess({}, () =>
      call("POST", "/api/auth/join-open", {
        body: { displayName: "Internet", deviceId: crypto.randomUUID() },
        xff: "203.0.113.7",
      }),
    );
    expect(res.status).toBe(403);
  });

  test("a missing forwarded header is refused, not assumed local", async () => {
    // The backstop exists to catch a proxy that isn't setting the header;
    // treating "no header" as trusted would defeat it entirely.
    const res = await withOpenAccess({}, () =>
      call("POST", "/api/auth/join-open", {
        body: { displayName: "Unknown", deviceId: crypto.randomUUID() },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("the private-client backstop can be turned off deliberately", async () => {
    const res = await withOpenAccess({ requirePrivate: false }, () =>
      call("POST", "/api/auth/join-open", {
        body: { displayName: "VPN user", deviceId: crypto.randomUUID() },
        xff: "203.0.113.7",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("stickers allocate with no secret, and a bare id still grants nothing", async () => {
    const codeless = await withOpenAccess({}, async () => {
      const res = await call("POST", "/api/admin/bins/allocate", {
        token: tokenA,
        body: { adminPassword: "admin-pw", count: 2 },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { bins: { id: number; code: null }[] };
    });
    expect(codeless.bins).toHaveLength(2);
    for (const bin of codeless.bins) expect(bin.code).toBeNull();

    // The load-bearing property: a codeless bin must not become a way in.
    // join-by-bin requires a stored secret, so there is no code — not even
    // an empty one — that opens it.
    const first = codeless.bins[0];
    expect(first).toBeDefined();
    for (const attempt of ["", "0000", "NULL"]) {
      const res = await call("POST", "/api/auth/join-by-bin", {
        body: {
          binId: first?.id,
          code: attempt,
          displayName: "Chancer",
          deviceId: crypto.randomUUID(),
        },
        xff: "203.0.113.7",
      });
      expect(res.status).not.toBe(200);
    }
  });
});
