/**
 * Reading a location hierarchy safely.
 *
 * Nesting is stored as a single `parentId` per place, which is enough to
 * describe a building → aisle → shelf tree but says nothing about whether the
 * result is actually a tree. Two devices offline can each reparent a place —
 * A under B on one, B under A on the other — and both writes are legitimate
 * LWW wins. The reducer cannot reject that without looking at other rows,
 * which would make it order-dependent and break convergence.
 *
 * So a cycle is a state the data model genuinely permits, and every walk has
 * to survive one. These helpers are the only sanctioned way to walk upwards.
 */

/** The minimum a place needs for any of this; matches LocationState. */
export type LocationNode = {
  id: string;
  name: string;
  parentId: string | null;
  cols?: number | null;
  rows?: number | null;
};

/**
 * Deep enough for any real building, shallow enough that a cycle costs
 * nothing. A hierarchy legitimately this deep is a data-entry mistake.
 */
export const MAX_LOCATION_DEPTH = 12;

/**
 * The chain from the outermost ancestor down to `id`.
 *
 * Stops at the first repeat, so a cycle yields a truncated path rather than
 * hanging the UI thread. Returns an empty array for an unknown id.
 */
export function locationPath(
  byId: ReadonlyMap<string, LocationNode>,
  id: string | null | undefined,
): LocationNode[] {
  const chain: LocationNode[] = [];
  const seen = new Set<string>();
  let current = id ? byId.get(id) : undefined;
  while (
    current &&
    !seen.has(current.id) &&
    chain.length < MAX_LOCATION_DEPTH
  ) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain.reverse();
}

/** "Aisle H › H4" — breadcrumbs for a place. */
export function locationLabel(
  byId: ReadonlyMap<string, LocationNode>,
  id: string | null | undefined,
  separator = " › ",
): string {
  return locationPath(byId, id)
    .map((l) => l.name)
    .join(separator);
}

/**
 * True when following parents from `id` returns to it.
 *
 * Worth surfacing in a builder UI: the data model allows this, so the honest
 * thing is to show it as broken rather than pretend it can't happen.
 */
export function hasCycle(
  byId: ReadonlyMap<string, LocationNode>,
  id: string,
): boolean {
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

/**
 * Would setting `parentId` on `childId` create a cycle? The check a builder
 * needs BEFORE writing, so the common case never produces broken data — the
 * walk-time guards above are the backstop for the concurrent case they can't
 * prevent.
 */
export function wouldCycle(
  byId: ReadonlyMap<string, LocationNode>,
  childId: string,
  parentId: string | null,
): boolean {
  if (!parentId) return false;
  if (parentId === childId) return true;
  const seen = new Set<string>([childId]);
  let current = byId.get(parentId);
  while (current) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

/** How many boxes a shelf holds, or null when it isn't a grid. */
export function slotCapacity(location: LocationNode): number | null {
  const { cols, rows } = location;
  if (!cols || !rows) return null;
  return cols * rows;
}

/**
 * Slot names, row-major: A1, A2, A3 / B1, B2, B3.
 *
 * Letters for rows and numbers for columns because that is how people read a
 * shelf out loud. The stored slot is just this string — the grid can be
 * resized later without rewriting any box's location, which is why the
 * reducer never validates one against the other.
 */
export function slotName(col: number, row: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

/** Every slot a location offers, in reading order. Empty when it has no grid. */
export function slotNames(location: LocationNode): string[] {
  const { cols, rows } = location;
  if (!cols || !rows) return [];
  const names: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) names.push(slotName(col, row));
  }
  return names;
}
