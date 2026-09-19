/**
 * How a box is referred to — by its number or by an opaque handle — is a
 * property of the DEPLOYMENT (`BOX_NUMBERS`, see api/config.ts), not of the
 * box. Every place that names a box, links to one, or puts one in a QR code
 * goes through here, so a deployment that keeps numbers internal never shows
 * one: not in a title, not in a toast, not in the address bar.
 *
 * The integer id stays the primary key everywhere (never reused, never
 * renumbered — see plans/multi-instance.md); the handle is a UUID minted with
 * it by bin.allocate. Boxes allocated before handles existed have none and
 * fall back to their number even on internal deployments, which is the only
 * honest option for a sticker that already exists.
 */
import type { BinState } from "@shared/reducer";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { useDeployment } from "./deployment";

export type BoxRef = Pick<BinState, "id" | "handle">;
export type BoxIdentity = Pick<BinState, "id" | "handle" | "name">;

/**
 * A handle as it appears in a URL. Case-insensitive because sticker URLs are
 * upper-cased to keep the QR in alphanumeric mode; stored handles are
 * lower-case, so callers normalise with `normalizeHandle` before a lookup.
 */
export const HANDLE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/** The path of a box's page: `/b/<handle>` where numbers are internal. */
export function boxPath(bin: BoxRef, internal: boolean): string {
  return internal && bin.handle ? `/b/${bin.handle}` : `/${bin.id}`;
}

/**
 * What to call a box in a heading or a sentence. Its name when it has one;
 * otherwise its number — or, where numbers are internal, a neutral
 * placeholder, because "#10" would be exactly the thing not to show.
 */
export function boxTitle(bin: BoxIdentity, internal: boolean): string {
  const name = bin.name?.trim();
  if (name) return name;
  return internal ? "Untitled box" : `#${bin.id}`;
}

/** The number as a secondary line, or null where numbers are internal. */
export function boxNumber(bin: BoxRef, internal: boolean): string | null {
  return internal ? null : `#${bin.id}`;
}

export function useBoxNumbersInternal(): boolean {
  return useDeployment()?.boxNumbers === "internal";
}

/**
 * Live title for a box by id — for toasts and captions on surfaces that only
 * hold the id (the scanner). "this box" while the replica has nothing yet.
 */
export function useBoxTitle(binId: number | null): string {
  const internal = useBoxNumbersInternal();
  const bin = useLiveQuery(
    async () => (binId === null ? null : ((await db.bins.get(binId)) ?? null)),
    [binId],
    null,
  );
  if (!bin) return "this box";
  return boxTitle(bin, internal);
}

/** Resolve a scanned or typed reference to the replica's row, if present. */
export async function findBox(ref: {
  binId: number | null;
  handle: string | null;
}): Promise<BinState | undefined> {
  if (ref.binId !== null) return db.bins.get(ref.binId);
  if (ref.handle !== null)
    return db.bins.where("handle").equals(normalizeHandle(ref.handle)).first();
  return undefined;
}
