/**
 * API integration test: the whole loop a phone performs — join with the access
 * code, allocate stickers, claim + annotate a bin, pull from a second device,
 * upload/fetch a photo blob — against a throwaway SQLite db.
 */
import { beforeAll, describe, expect, test } from "bun:test";
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
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
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
  beforeAll(async () => {
    await db.insert(schema.group).values({
      id: crypto.randomUUID(),
      name: "Test Camp",
      accessCodeHash: sha256Hex("secret-code"),
    });
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
    const alloc = await call("POST", "/api/bins/allocate", {
      token: tokenA,
      body: { count: 3 },
    });
    expect(alloc.status).toBe(200);
    allocated = ((await alloc.json()) as { bins: typeof allocated }).bins;
    expect(allocated).toHaveLength(3);
    expect(Math.min(...allocated.map((b) => b.id))).toBeGreaterThanOrEqual(100);
    // Every sticker gets a secret from the confusable-free alphabet.
    for (const { code } of allocated) {
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
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
});
