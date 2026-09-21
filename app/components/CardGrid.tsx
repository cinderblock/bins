/**
 * The settings/admin board: independent cards flowed into as many columns as
 * the window has room for.
 *
 * CSS multi-column rather than a grid, deliberately. These cards have wildly
 * different heights — a two-line switch next to a device table — and a grid
 * aligns rows, so every short card would sit above a crater. Multi-column
 * balances instead, and needs no breakpoints: one column on a phone, four on
 * a desk monitor, decided by `column-width` alone.
 *
 * Each card is wrapped rather than styled in place, so a section can be an
 * arbitrary component (`<PushToggle />`) and still get `break-inside: avoid`
 * and the gap. `Children.toArray` drops `null`/`false`, so `{cond && <Card/>}`
 * costs nothing; a component that RETURNS null leaves an empty wrapper, which
 * `.bins-card-grid > div:empty` hides (lib/ui.ts).
 */
import {
  Children,
  type ReactElement,
  type ReactNode,
  isValidElement,
} from "react";
import { CARD_MINW } from "~/lib/ui";

/**
 * A section that spans every column. `column-span: all` resets the flow
 * around it, so the board reads as bands — right for the one section that
 * genuinely wants the whole width (the shelf builder), wrong for anything
 * smaller.
 */
export function CardGridWide({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function CardGrid({
  /** Narrowest a column may get before the browser drops one. */
  minColumnWidth = CARD_MINW,
  children,
}: {
  minColumnWidth?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="bins-card-grid"
      style={{
        columnWidth: minColumnWidth,
        columnGap: "var(--mantine-spacing-md)",
      }}
    >
      {Children.toArray(children).map((child) => {
        const wide = isValidElement(child) && child.type === CardGridWide;
        return (
          <div
            key={(child as ReactElement).key}
            style={{
              breakInside: "avoid",
              marginBottom: "var(--mantine-spacing-md)",
              columnSpan: wide ? "all" : undefined,
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}
