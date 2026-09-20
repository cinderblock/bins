/**
 * A minimal IPP client: one Print-Job with an image document.
 *
 * Most label printers with a network stack — and anything that does AirPrint —
 * already accept `image/png` over IPP (RFC 8010/8011), so speaking it means
 * bins can print to them with no shim on the printer's side. This is the
 * whole of what that takes: IPP is HTTP POST with a small binary envelope
 * (version, operation, request id, a handful of typed attributes, an
 * end-of-attributes byte) followed by the document bytes.
 *
 * Deliberately not a dependency: the encoder is thirty lines, the only
 * response field that matters is the status code, and a printer that
 * misbehaves is easier to reason about with the bytes in view.
 */

/** IPP attribute value tags used here (RFC 8010 §3.5.2). */
const TAG = {
  operationAttributes: 0x01,
  endOfAttributes: 0x03,
  charset: 0x47,
  naturalLanguage: 0x48,
  uri: 0x45,
  nameWithoutLanguage: 0x42,
  mimeMediaType: 0x49,
} as const;

const PRINT_JOB = 0x0002;

function attribute(tag: number, name: string, value: string): Buffer {
  const n = Buffer.from(name, "utf8");
  const v = Buffer.from(value, "utf8");
  const out = Buffer.alloc(1 + 2 + n.length + 2 + v.length);
  let at = 0;
  out.writeUInt8(tag, at++);
  out.writeUInt16BE(n.length, at);
  at += 2;
  n.copy(out, at);
  at += n.length;
  out.writeUInt16BE(v.length, at);
  at += 2;
  v.copy(out, at);
  return out;
}

/**
 * Encode a Print-Job request for `document` (a PNG by default).
 *
 * `printerUri` is echoed to the printer as it expects to see itself
 * (ipp://host:631/path); that is not the HTTP transport URL, which
 * `transportUrl` derives.
 */
export function encodePrintJob(
  printerUri: string,
  document: Uint8Array,
  options: { requestId?: number; user?: string; format?: string } = {},
): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt8(2, 0); // IPP/2.0
  header.writeUInt8(0, 1);
  header.writeUInt16BE(PRINT_JOB, 2);
  header.writeUInt32BE(options.requestId ?? 1, 4);
  const attrs = Buffer.concat([
    Buffer.from([TAG.operationAttributes]),
    // These two MUST come first, in this order (RFC 8011 §4.1.4).
    attribute(TAG.charset, "attributes-charset", "utf-8"),
    attribute(TAG.naturalLanguage, "attributes-natural-language", "en"),
    attribute(TAG.uri, "printer-uri", printerUri),
    attribute(
      TAG.nameWithoutLanguage,
      "requesting-user-name",
      options.user ?? "bins",
    ),
    attribute(
      TAG.mimeMediaType,
      "document-format",
      options.format ?? "image/png",
    ),
    Buffer.from([TAG.endOfAttributes]),
  ]);
  return Buffer.concat([header, attrs, Buffer.from(document)]);
}

/** ipp://host[:port]/path → http://host:port/path (ipps → https). */
export function transportUrl(printerUri: string): string {
  const url = new URL(printerUri);
  const secure = url.protocol === "ipps:";
  const port = url.port || (secure ? "443" : "631");
  return `${secure ? "https" : "http"}://${url.hostname}:${port}${url.pathname}${url.search}`;
}

export function isIppUrl(url: string): boolean {
  return /^ipps?:\/\//i.test(url);
}

/** Status codes a printer may answer with, for a readable failure. */
const STATUS: Record<number, string> = {
  0: "successful-ok",
  1: "successful-ok-ignored-or-substituted-attributes",
  2: "successful-ok-conflicting-attributes",
  1024: "client-error-bad-request",
  1025: "client-error-forbidden",
  1027: "client-error-not-authenticated",
  1028: "client-error-not-authorized",
  1030: "client-error-not-found",
  1033: "client-error-request-entity-too-large",
  1034: "client-error-request-value-too-long",
  1035: "client-error-document-format-not-supported",
  1036: "client-error-attributes-or-values-not-supported",
  1280: "server-error-internal-error",
  1281: "server-error-operation-not-supported",
  1282: "server-error-service-unavailable",
  1286: "server-error-temporary-error",
  1287: "server-error-not-accepting-jobs",
  1288: "server-error-busy",
};

/** The status code out of a response, and its name where known. */
export function decodeStatus(response: Uint8Array): {
  code: number;
  name: string;
  ok: boolean;
} {
  if (response.length < 4) return { code: -1, name: "empty reply", ok: false };
  const code = ((response[2] ?? 0) << 8) | (response[3] ?? 0);
  return {
    code,
    name: STATUS[code] ?? `0x${code.toString(16).padStart(4, "0")}`,
    ok: code < 0x0100,
  };
}

/**
 * Send one Print-Job. Resolves on a successful status; throws with the
 * printer's own status name otherwise — "server-error-not-accepting-jobs"
 * tells a person more than "print failed".
 */
export async function printViaIpp(
  printerUri: string,
  document: Uint8Array,
  options: { timeoutMs?: number; format?: string } = {},
): Promise<void> {
  const body = encodePrintJob(printerUri, document, {
    requestId: Date.now() & 0x7fffffff || 1,
    format: options.format,
  });
  const response = await fetch(transportUrl(printerUri), {
    method: "POST",
    headers: { "Content-Type": "application/ipp" },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `printer answered HTTP ${response.status} ${detail}`.trim(),
    );
  }
  const status = decodeStatus(new Uint8Array(await response.arrayBuffer()));
  if (!status.ok) throw new Error(`printer refused the job: ${status.name}`);
}
