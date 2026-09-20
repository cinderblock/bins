/**
 * IPP client tests: the envelope is decoded back by hand so a printer that
 * ever rejects a job can be checked byte-for-byte against the spec.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  decodeStatus,
  encodePrintJob,
  isIppUrl,
  printViaIpp,
  transportUrl,
} from "./ipp";

/** Walk the attribute group back out of an encoded request. */
function decode(buf: Buffer) {
  const version = `${buf[0]}.${buf[1]}`;
  const op = buf.readUInt16BE(2);
  const requestId = buf.readUInt32BE(4);
  let at = 8;
  expect(buf[at++]).toBe(0x01); // operation-attributes-tag
  const attrs: { tag: number; name: string; value: string }[] = [];
  while (buf[at] !== 0x03) {
    const tag = buf[at++] as number;
    const nl = buf.readUInt16BE(at);
    at += 2;
    const name = buf.subarray(at, at + nl).toString("utf8");
    at += nl;
    const vl = buf.readUInt16BE(at);
    at += 2;
    const value = buf.subarray(at, at + vl).toString("utf8");
    at += vl;
    attrs.push({ tag, name, value });
  }
  at++; // end-of-attributes
  return { version, op, requestId, attrs, document: buf.subarray(at) };
}

describe("IPP Print-Job encoding", () => {
  test("a spec-shaped request: header, ordered attributes, then the bytes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const req = decode(
      encodePrintJob("ipp://printer.local:631/ipp/print", png, {
        requestId: 42,
      }),
    );
    expect(req.version).toBe("2.0");
    expect(req.op).toBe(0x0002);
    expect(req.requestId).toBe(42);
    // charset and natural-language MUST lead, in that order.
    expect(req.attrs.slice(0, 2).map((a) => a.name)).toEqual([
      "attributes-charset",
      "attributes-natural-language",
    ]);
    const byName = Object.fromEntries(req.attrs.map((a) => [a.name, a]));
    expect(byName["attributes-charset"]?.tag).toBe(0x47);
    expect(byName["printer-uri"]).toMatchObject({
      tag: 0x45,
      value: "ipp://printer.local:631/ipp/print",
    });
    expect(byName["document-format"]).toMatchObject({
      tag: 0x49,
      value: "image/png",
    });
    expect([...req.document]).toEqual([...png]);
  });

  test("ipp:// becomes plain HTTP on 631; ipps:// becomes HTTPS", () => {
    expect(transportUrl("ipp://labelpi/ipp/print")).toBe(
      "http://labelpi:631/ipp/print",
    );
    expect(transportUrl("ipp://labelpi:8631/x")).toBe("http://labelpi:8631/x");
    expect(transportUrl("ipps://labelpi/ipp/print")).toBe(
      "https://labelpi:443/ipp/print",
    );
    expect(isIppUrl("ipp://x")).toBe(true);
    expect(isIppUrl("IPPS://x")).toBe(true);
    expect(isIppUrl("http://x")).toBe(false);
  });

  test("status decoding names the printer's answer", () => {
    expect(
      decodeStatus(new Uint8Array([2, 0, 0, 0, 0, 0, 0, 1])),
    ).toMatchObject({ ok: true, name: "successful-ok" });
    expect(
      decodeStatus(new Uint8Array([2, 0, 0x05, 0x07, 0, 0, 0, 1])),
    ).toMatchObject({ ok: false, name: "server-error-not-accepting-jobs" });
    expect(
      decodeStatus(new Uint8Array([2, 0, 0x04, 0x99, 0, 0, 0, 1])),
    ).toMatchObject({ ok: false, name: "0x0499" });
    expect(decodeStatus(new Uint8Array([]))).toMatchObject({ ok: false });
  });
});

describe("printViaIpp", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("posts application/ipp to the transport URL and reads the status", async () => {
    let seen: { url: string; type: string | null; body: Uint8Array } | null =
      null;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      seen = {
        url: String(input),
        type: new Headers(init?.headers).get("content-type"),
        body: init?.body as Uint8Array,
      };
      return new Response(new Uint8Array([2, 0, 0, 0, 0, 0, 0, 1, 3]), {
        status: 200,
        headers: { "Content-Type": "application/ipp" },
      });
    }) as unknown as typeof fetch;
    await printViaIpp("ipp://labelpi:631/ipp/print", new Uint8Array([1, 2]));
    const s = seen as unknown as {
      url: string;
      type: string;
      body: Uint8Array;
    };
    expect(s.url).toBe("http://labelpi:631/ipp/print");
    expect(s.type).toBe("application/ipp");
    expect(s.body[2]).toBe(0);
    expect(s.body[3]).toBe(2); // Print-Job
  });

  test("a refusing printer surfaces its own status name", async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([2, 0, 0x05, 0x07, 0, 0, 0, 1, 3]), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(
      printViaIpp("ipp://labelpi/ipp/print", new Uint8Array([1])),
    ).rejects.toThrow("server-error-not-accepting-jobs");
  });
});
