/**
 * The floor plan, drawn. One SVG whose viewBox is in world millimetres, so
 * zoom and pan are just the viewBox moving and hit-testing is the browser's.
 *
 * It owns the VIEW (pan, zoom, pinch, fit) and nothing else. Every pointer
 * gesture is classified here — a tap, a drag of something, or a pan — and
 * handed out: taps to `onTap`, drags to whatever `onDragStart` returns. The
 * viewer and the editor draw the same picture through the same component;
 * only who answers those two callbacks differs.
 *
 * Sizes that should look the same at every zoom (strokes, handles, text) are
 * written as `px(n)` — n screen pixels, converted to world units at the
 * current zoom — rather than with `vector-effect: non-scaling-stroke`, whose
 * interaction with dash arrays differs between browsers.
 */
import { ActionIcon, Group } from "@mantine/core";
import {
  type Point,
  type Rect,
  landmarkKind,
  planBounds,
} from "@shared/floorplan";
import type { Landmark } from "@shared/ops";
import { IconFocusCentered, IconMinus, IconPlus } from "@tabler/icons-react";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  FULLNESS_RAMP,
  OVER_COLOR,
  type PlaceStats,
  type Scene,
  type SceneItem,
  fullnessClass,
} from "~/lib/floorplan";
import { type LengthUnit, formatLength } from "~/lib/lengths";

export type ColorBy = "fullness" | "category" | "none";

/** What a pointer went down on. Encoded into `data-t` on the element. */
export type Target =
  | { t: "item"; id: string; bayId: string | null }
  | { t: "lm"; id: string }
  | { t: "rot"; of: "item" | "lm"; id: string }
  | {
      t: "size";
      of: "item" | "lm";
      id: string;
      edge: "left" | "right" | "back";
    }
  | { t: "vtx"; index: number }
  | { t: "mid"; index: number };

function encode(target: Target): string {
  switch (target.t) {
    case "item":
      return `item|${target.id}|${target.bayId ?? ""}`;
    case "lm":
      return `lm|${target.id}`;
    case "rot":
      return `rot|${target.of}|${target.id}`;
    case "size":
      return `size|${target.of}|${target.id}|${target.edge}`;
    case "vtx":
      return `vtx|${target.index}`;
    case "mid":
      return `mid|${target.index}`;
  }
}

function decode(raw: string | null | undefined): Target | null {
  if (!raw) return null;
  const [t, a = "", b = "", c = ""] = raw.split("|");
  switch (t) {
    case "item":
      return { t, id: a, bayId: b || null };
    case "lm":
      return { t, id: a };
    case "rot":
      return { t, of: a as "item" | "lm", id: b };
    case "size":
      return {
        t,
        of: a as "item" | "lm",
        id: b,
        edge: c as "left" | "right" | "back",
      };
    case "vtx":
    case "mid":
      return { t, index: Number(a) };
    default:
      return null;
  }
}

/** A drag in progress, owned by whoever started it. */
export type DragHandler = {
  move: (world: Point, e: PointerEvent) => void;
  end: (world: Point) => void;
  cancel: () => void;
};

export type Selection =
  | { t: "item"; id: string }
  | { t: "lm"; id: string }
  | { t: "vtx"; index: number };

export type FloorPlanHandle = {
  fit: () => void;
  /** The world point at the centre of the view — where new things land. */
  center: () => Point;
};

type View = { x: number; y: number; w: number; h: number };

/** Movement (px) under which a press is a tap, not a drag. */
const TAP_SLOP = 6;
const MIN_VIEW_W = 400;
const MAX_VIEW_W = 1_000_000;

export function FloorPlanSvg({
  scene,
  colorBy,
  scheme,
  highlight = null,
  focus = null,
  selection = null,
  editing = false,
  outlineEditing = false,
  gridStep = null,
  unit,
  interactive = true,
  height,
  onTap,
  onDragStart,
  fitKey,
  overlay,
  handle,
}: {
  scene: Scene;
  colorBy: ColorBy;
  scheme: "dark" | "light";
  /** "The box is here" — pulses until it's looked at. */
  highlight?: { itemId: string; bayId: string | null } | null;
  /** What the viewer tapped — outlined, steady. */
  focus?: { itemId: string; bayId: string | null } | null;
  selection?: Selection | null;
  editing?: boolean;
  outlineEditing?: boolean;
  /** Grid line spacing in mm; null = no grid. */
  gridStep?: number | null;
  unit: LengthUnit;
  /** False for the thumbnail: no pan/zoom, no controls, pointer passes through. */
  interactive?: boolean;
  height: number | string;
  onTap?: (target: Target | null, world: Point) => void;
  onDragStart?: (target: Target, world: Point) => DragHandler | null;
  /** Changes to this re-fit the view (a different space, say). */
  fitKey: string;
  /** Extra controls drawn over the map's top-left corner. */
  overlay?: ReactNode;
  handle?: Ref<FloorPlanHandle>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [view, setView] = useState<View>({ x: 0, y: 0, w: 10000, h: 6000 });

  // Container size, for converting screen pixels to world units.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () =>
      setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fitting reads the latest bounds through a ref: it is keyed on fitKey,
  // not re-run on every drag of every wall.
  const boundsRef = useRef<Rect | null>(null);
  boundsRef.current = sceneBounds(scene);
  const fit = useCallback(() => {
    const b = boundsRef.current ?? {
      minX: 0,
      minY: 0,
      maxX: 10000,
      maxY: 6000,
    };
    const w = Math.max(b.maxX - b.minX, 2000);
    const h = Math.max(b.maxY - b.minY, 2000);
    const pad = Math.max(w, h) * 0.08;
    setView({
      x: (b.minX + b.maxX) / 2 - w / 2 - pad,
      y: (b.minY + b.maxY) / 2 - h / 2 - pad,
      w: w + pad * 2,
      h: h + pad * 2,
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refit only when the space changes
  useEffect(() => {
    fit();
  }, [fitKey]);

  // With preserveAspectRatio "meet", one screen pixel is the larger of the
  // two ratios.
  const mmPerPx = Math.max(view.w / size.w, view.h / size.h);
  const px = (n: number) => n * mmPerPx;

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      fit,
      center: () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 }),
    }),
    [fit, view],
  );

  /** Zoom by `factor` (>1 = out) keeping `anchor` (world) under the pointer. */
  const zoomAt = useCallback((anchor: Point, factor: number) => {
    setView((v) => {
      const w = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, v.w * factor));
      const k = w / v.w;
      return {
        x: anchor.x - (anchor.x - v.x) * k,
        y: anchor.y - (anchor.y - v.y) * k,
        w,
        h: v.h * k,
      };
    });
  }, []);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad pinch arrives as ctrl+wheel with small deltas; both are
      // just "zoom by this much" here.
      const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(toWorld(e.clientX, e.clientY), factor);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [interactive, toWorld, zoomAt]);

  // ── Gestures ──
  type Gesture =
    | { kind: "pending"; target: Target | null; x: number; y: number }
    | { kind: "pan"; lastX: number; lastY: number }
    | { kind: "drag"; handler: DragHandler }
    | { kind: "pinch"; dist: number; mid: Point; view: View }
    | { kind: "none" };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({ kind: "none" });

  function startPinch() {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    if (gesture.current.kind === "drag") gesture.current.handler.cancel();
    gesture.current = {
      kind: "pinch",
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2),
      view,
    };
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Capture keeps a drag alive when the pointer leaves the map. It throws
    // for a pointer the browser no longer considers active (a pen that
    // lifted mid-event, a synthetic event); the gesture still works
    // without it, just not past the map's edge.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    const el = (e.target as Element).closest("[data-t]");
    gesture.current = {
      kind: "pending",
      target: decode(el?.getAttribute("data-t")),
      x: e.clientX,
      y: e.clientY,
    };
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const factor = g.dist / dist;
      const w = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, g.view.w * factor));
      const k = w / g.view.w;
      const h = g.view.h * k;
      // Keep the world point that started under the fingers' midpoint
      // under their midpoint now: zoom and two-finger pan in one.
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      if (!rect) return;
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const scale = Math.max(w / rect.width, h / rect.height);
      // "meet" centres the viewBox; offset for the letterbox.
      const offX = (rect.width - w / scale) / 2;
      const offY = (rect.height - h / scale) / 2;
      setView({
        x: g.mid.x - (midX - offX) * scale,
        y: g.mid.y - (midY - offY) * scale,
        w,
        h,
      });
      return;
    }
    if (g.kind === "pending") {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < TAP_SLOP) return;
      const handler =
        g.target && onDragStart
          ? onDragStart(g.target, toWorld(g.x, g.y))
          : null;
      gesture.current = handler
        ? { kind: "drag", handler }
        : { kind: "pan", lastX: g.x, lastY: g.y };
    }
    const now = gesture.current;
    if (now.kind === "drag") {
      now.handler.move(toWorld(e.clientX, e.clientY), e.nativeEvent);
    } else if (now.kind === "pan") {
      const dx = (e.clientX - now.lastX) * mmPerPx;
      const dy = (e.clientY - now.lastY) * mmPerPx;
      now.lastX = e.clientX;
      now.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.kind === "pinch") {
      // Lifting one finger of a pinch ends it; the other doesn't start a pan.
      gesture.current = { kind: "none" };
      return;
    }
    if (pointers.current.size > 0) return;
    if (g.kind === "pending") onTap?.(g.target, toWorld(e.clientX, e.clientY));
    else if (g.kind === "drag") g.handler.end(toWorld(e.clientX, e.clientY));
    gesture.current = { kind: "none" };
  }

  function onPointerCancel(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === "drag") g.handler.cancel();
    gesture.current = { kind: "none" };
  }

  // ── Drawing ──
  const ramp = FULLNESS_RAMP[scheme];
  const neutral =
    scheme === "dark"
      ? "var(--mantine-color-dark-4)"
      : "var(--mantine-color-gray-3)";
  const floor =
    scheme === "dark"
      ? "var(--mantine-color-dark-6)"
      : "var(--mantine-color-gray-0)";
  const line = "var(--mantine-color-dimmed)";
  const ink = "var(--mantine-color-text)";
  const halo = "var(--mantine-color-body)";
  const accent = "var(--mantine-primary-color-filled)";

  function segmentFill(stats: PlaceStats): string {
    if (colorBy === "fullness") {
      const cls = fullnessClass(stats);
      if (cls === null) return neutral;
      if (cls === 0) return "transparent";
      return ramp[cls - 1] as string;
    }
    if (colorBy === "category") {
      const c = stats.topLabel?.color;
      return c ? `var(--mantine-color-${c}-filled)` : neutral;
    }
    return neutral;
  }

  const textProps = (size: number) =>
    ({
      fontSize: px(size),
      fill: ink,
      stroke: halo,
      strokeWidth: px(3),
      paintOrder: "stroke",
      textAnchor: "middle",
      dominantBaseline: "central",
      style: { userSelect: "none", pointerEvents: "none" },
    }) as const;

  /** Font size (px) that fits `room` world units, or null if unreadable. */
  const fitText = (room: number, chars: number, max = 13): number | null => {
    const pxRoom = room / mmPerPx;
    const sizePx = Math.min(max, pxRoom / Math.max(1.2, chars * 0.62));
    return sizePx >= 8 ? sizePx : null;
  };

  const selectedItem =
    selection?.t === "item"
      ? scene.items.find((i) => i.place.id === selection.id)
      : null;
  const selectedLandmark =
    selection?.t === "lm"
      ? scene.landmarks.find((l) => l.id === selection.id)
      : null;

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: "var(--mantine-radius-md)",
        overflow: "hidden",
        background: "var(--mantine-color-body)",
        border: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <svg
        ref={svgRef}
        role="img"
        aria-label="Floor plan"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
        style={{
          display: "block",
          touchAction: interactive ? "none" : "auto",
          cursor: interactive ? (editing ? "default" : "grab") : "pointer",
          pointerEvents: interactive ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <style>{`
          .fp-pulse { animation: fp-pulse 1.4s ease-in-out infinite; }
          @keyframes fp-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }
          @media (prefers-reduced-motion: reduce) { .fp-pulse { animation: none } }
        `}</style>
        {gridStep && (
          <>
            <defs>
              <pattern
                id="fp-grid"
                width={gridStep}
                height={gridStep}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`}
                  fill="none"
                  stroke={line}
                  strokeOpacity={0.25}
                  strokeWidth={px(1)}
                />
              </pattern>
            </defs>
            <rect
              x={view.x}
              y={view.y}
              width={view.w}
              height={view.h}
              fill="url(#fp-grid)"
            />
          </>
        )}

        {scene.outline.length >= 3 && (
          <polygon
            points={scene.outline.map(([x, y]) => `${x},${y}`).join(" ")}
            fill={floor}
            stroke={line}
            strokeWidth={px(4)}
            strokeLinejoin="round"
          />
        )}

        {scene.landmarks.map((l) => (
          <LandmarkShape
            key={l.id}
            landmark={l}
            px={px}
            floor={floor}
            line={line}
            textProps={textProps}
            fitText={fitText}
            editing={editing}
          />
        ))}

        {scene.items.map((item) => (
          <ItemShape
            key={item.place.id}
            item={item}
            px={px}
            fill={segmentFill}
            line={line}
            accent={accent}
            textProps={textProps}
            fitText={fitText}
            highlight={
              highlight?.itemId === item.place.id ? highlight.bayId : undefined
            }
            focus={focus?.itemId === item.place.id ? focus.bayId : undefined}
            selected={selectedItem?.place.id === item.place.id}
            compact={!interactive}
          />
        ))}

        {editing && selectedItem && (
          <Handles
            of="item"
            id={selectedItem.place.id}
            f={selectedItem.layout}
            px={px}
            accent={accent}
          />
        )}
        {editing && selectedLandmark && (
          <Handles
            of="lm"
            id={selectedLandmark.id}
            f={selectedLandmark}
            px={px}
            accent={accent}
            noDepth={landmarkKind(selectedLandmark.kind) === "door"}
          />
        )}

        {outlineEditing && (
          <OutlineHandles
            outline={scene.outline}
            px={px}
            accent={accent}
            selected={selection?.t === "vtx" ? selection.index : null}
          />
        )}
      </svg>

      {interactive && (
        <>
          <Group
            gap={4}
            style={{ position: "absolute", top: 8, right: 8 }}
            wrap="nowrap"
          >
            <ActionIcon
              variant="default"
              aria-label="Zoom in"
              onClick={() =>
                zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 0.7)
              }
            >
              <IconPlus size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              aria-label="Zoom out"
              onClick={() =>
                zoomAt(
                  { x: view.x + view.w / 2, y: view.y + view.h / 2 },
                  1 / 0.7,
                )
              }
            >
              <IconMinus size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              aria-label="Fit the whole plan"
              onClick={fit}
            >
              <IconFocusCentered size={16} />
            </ActionIcon>
          </Group>
          {overlay && (
            <div style={{ position: "absolute", top: 8, left: 8, right: 120 }}>
              {overlay}
            </div>
          )}
          {scene.scaled && <ScaleBar mmPerPx={mmPerPx} unit={unit} />}
        </>
      )}
    </div>
  );
}

function sceneBounds(scene: Scene): Rect | null {
  return planBounds(
    {
      scaled: scene.scaled,
      outline: scene.outline,
      landmarks: scene.landmarks,
    },
    scene.items.map((i) => i.layout),
  );
}

type TextProps = (size: number) => React.SVGProps<SVGTextElement>;
type FitText = (room: number, chars: number, max?: number) => number | null;

function ItemShape({
  item,
  px,
  fill,
  line,
  accent,
  textProps,
  fitText,
  highlight,
  focus,
  selected,
  compact,
}: {
  item: SceneItem;
  px: (n: number) => number;
  fill: (stats: PlaceStats) => string;
  line: string;
  accent: string;
  textProps: TextProps;
  fitText: FitText;
  /** undefined = not this item; null = the whole item; id = that bay. */
  highlight: string | null | undefined;
  focus: string | null | undefined;
  selected: boolean;
  /**
   * The thumbnail: bay letters only. At 150px tall, wall names and counts
   * pile into each other, and the pulse plus the caption under the
   * thumbnail already say where it is.
   */
  compact: boolean;
}) {
  const { layout, kind, place } = item;
  const w = layout.width;
  const d = layout.depth;
  const r = layout.rotation;
  const zone = kind === "zone" || kind === "space";
  // Text is counter-rotated to stay upright however the item is turned.
  const upright = (x: number, y: number) =>
    `translate(${x} ${y}) rotate(${-r})`;
  // The name goes out in front, in the aisle — behind is usually a wall —
  // anchored so it grows AWAY from the item whichever way the front faces.
  // Centred under a wall facing down the page, it would sit across the
  // front edge of one facing sideways.
  const frontX = -Math.sin((r * Math.PI) / 180);
  const sideways = Math.abs(frontX) > 0.7;
  const nameAnchor = sideways ? (frontX < 0 ? "end" : "start") : "middle";
  const nameY = d / 2 + px(sideways ? 12 : 22);
  const nameSize = fitText(Math.max(w, px(160)), place.name.length, 13);

  return (
    <g transform={`translate(${layout.x} ${layout.y}) rotate(${r})`}>
      {item.segments.map((seg) => {
        const segW = seg.to - seg.from;
        const cx = (seg.from + seg.to) / 2;
        const id = seg.bay?.id ?? null;
        const isHighlighted =
          highlight !== undefined && (highlight === null || highlight === id);
        const isFocused =
          focus !== undefined && (focus === null || focus === id);
        const label = seg.bay?.name ?? (zone ? place.name : "");
        const count =
          seg.stats.capacity != null
            ? `${seg.stats.used}/${seg.stats.capacity}`
            : seg.stats.boxes
              ? String(seg.stats.boxes)
              : "";
        const labelSize = label
          ? fitText(Math.min(segW, d * 2.2), label.length)
          : null;
        const countSize = count
          ? fitText(Math.min(segW, d * 2.2), count.length, 11)
          : null;
        const both = !compact && labelSize && countSize && d / px(1) > 34;
        return (
          <g
            key={id ?? "whole"}
            data-t={encode({ t: "item", id: place.id, bayId: id })}
          >
            <rect
              x={seg.from}
              y={-d / 2}
              width={segW}
              height={d}
              rx={px(2)}
              fill={fill(seg.stats)}
              fillOpacity={0.85}
              stroke={seg.stats.over ? OVER_COLOR : line}
              strokeWidth={px(seg.stats.over ? 2.5 : 1.25)}
              strokeDasharray={zone ? `${px(6)} ${px(4)}` : undefined}
              style={{ cursor: "pointer" }}
            />
            {labelSize && (
              <text
                transform={upright(cx, both ? -px(labelSize * 0.55) : 0)}
                {...textProps(labelSize)}
                fontWeight={700}
              >
                {label}
              </text>
            )}
            {countSize && !compact && (both || !labelSize) && (
              <text
                transform={upright(cx, both ? px(countSize * 0.7) : 0)}
                {...textProps(countSize)}
              >
                {seg.stats.over ? `${count} !` : count}
              </text>
            )}
            {isFocused && (
              <rect
                x={seg.from - px(3)}
                y={-d / 2 - px(3)}
                width={segW + px(6)}
                height={d + px(6)}
                rx={px(4)}
                fill="none"
                stroke={accent}
                strokeWidth={px(2.5)}
              />
            )}
            {isHighlighted && (
              <rect
                className="fp-pulse"
                x={seg.from - px(5)}
                y={-d / 2 - px(5)}
                width={segW + px(10)}
                height={d + px(10)}
                rx={px(6)}
                fill="none"
                stroke="var(--mantine-color-yellow-5)"
                strokeWidth={px(4)}
                style={{ pointerEvents: "none" }}
              />
            )}
          </g>
        );
      })}
      {/* The front — the side you stand on to reach it. A heavy edge plus a
          small arrow out into the aisle, so "which way does this face" is
          never a guess. Zones have no front. */}
      {!zone && (
        <g style={{ pointerEvents: "none" }}>
          <line
            x1={-w / 2}
            y1={d / 2}
            x2={w / 2}
            y2={d / 2}
            stroke={accent}
            strokeWidth={px(3.5)}
            strokeLinecap="round"
          />
          <path
            d={`M ${-px(6)} ${d / 2 + px(4)} L ${px(6)} ${d / 2 + px(4)} L 0 ${d / 2 + px(10)} Z`}
            fill={accent}
          />
        </g>
      )}
      {!zone && nameSize && !compact && (
        <text
          transform={upright(0, nameY)}
          {...textProps(nameSize)}
          textAnchor={nameAnchor}
          fontWeight={600}
        >
          {place.name}
        </text>
      )}
      {selected && (
        <rect
          x={-w / 2 - px(6)}
          y={-d / 2 - px(6)}
          width={w + px(12)}
          height={d + px(12)}
          fill="none"
          stroke={accent}
          strokeWidth={px(1.5)}
          strokeDasharray={`${px(5)} ${px(4)}`}
          style={{ pointerEvents: "none" }}
        />
      )}
    </g>
  );
}

function LandmarkShape({
  landmark: l,
  px,
  floor,
  line,
  textProps,
  fitText,
  editing,
}: {
  landmark: Landmark;
  px: (n: number) => number;
  floor: string;
  line: string;
  textProps: TextProps;
  fitText: FitText;
  editing: boolean;
}) {
  const kind = landmarkKind(l.kind);
  const w = l.width;
  const d = l.depth;
  const size = l.label ? fitText(w, l.label.length, 12) : null;
  const label = size && l.label && (
    <text
      transform={`rotate(${-l.rotation})`}
      {...textProps(size)}
      fontStyle="italic"
    >
      {l.label}
    </text>
  );
  return (
    <g
      transform={`translate(${l.x} ${l.y}) rotate(${l.rotation})`}
      data-t={encode({ t: "lm", id: l.id })}
      style={{ cursor: editing ? "move" : "default" }}
    >
      {kind === "door" && (
        <>
          {/* A gap in the wall, and the swing of the door into the room. */}
          <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={floor} />
          <path
            d={`M ${-w / 2} 0 L ${-w / 2} ${w} A ${w} ${w} 0 0 0 ${w / 2} 0`}
            fill="none"
            stroke={line}
            strokeWidth={px(1)}
            strokeDasharray={`${px(4)} ${px(3)}`}
          />
          <line
            x1={-w / 2}
            y1={0}
            x2={-w / 2}
            y2={w}
            stroke={line}
            strokeWidth={px(2)}
          />
        </>
      )}
      {kind === "pillar" && (
        <rect
          x={-w / 2}
          y={-d / 2}
          width={w}
          height={d}
          fill={line}
          fillOpacity={0.6}
        />
      )}
      {kind === "fixture" && (
        <rect
          x={-w / 2}
          y={-d / 2}
          width={w}
          height={d}
          rx={px(2)}
          fill="none"
          stroke={line}
          strokeWidth={px(1.5)}
        />
      )}
      {kind === "text" && (
        // Invisible box to grab by; the words are the landmark.
        <rect
          x={-w / 2}
          y={-d / 2}
          width={w}
          height={d}
          fill="transparent"
          stroke={editing ? line : "none"}
          strokeWidth={px(1)}
          strokeDasharray={`${px(3)} ${px(3)}`}
        />
      )}
      {kind !== "door" && label}
      {kind === "door" && l.label && size && (
        <text
          transform={`translate(0 ${-px(10)}) rotate(${-l.rotation})`}
          {...textProps(size)}
        >
          {l.label}
        </text>
      )}
    </g>
  );
}

function Handles({
  of,
  id,
  f,
  px,
  accent,
  noDepth,
}: {
  of: "item" | "lm";
  id: string;
  f: { x: number; y: number; rotation: number; width: number; depth: number };
  px: (n: number) => number;
  accent: string;
  noDepth?: boolean;
}) {
  const w = f.width / 2;
  const d = f.depth / 2;
  const knob = (x: number, y: number, target: Target, cursor: string) => (
    <g data-t={encode(target)} style={{ cursor }}>
      {/* Fat invisible ring: a finger needs far more than the visible dot. */}
      <circle cx={x} cy={y} r={px(14)} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={px(5.5)}
        fill="var(--mantine-color-body)"
        stroke={accent}
        strokeWidth={px(2)}
      />
    </g>
  );
  const rotY = -d - px(28);
  return (
    <g transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}>
      <line
        x1={0}
        y1={-d}
        x2={0}
        y2={rotY}
        stroke={accent}
        strokeWidth={px(1.5)}
        style={{ pointerEvents: "none" }}
      />
      {knob(0, rotY, { t: "rot", of, id }, "grab")}
      {knob(-w, 0, { t: "size", of, id, edge: "left" }, "ew-resize")}
      {knob(w, 0, { t: "size", of, id, edge: "right" }, "ew-resize")}
      {!noDepth &&
        knob(0, -d, { t: "size", of, id, edge: "back" }, "ns-resize")}
    </g>
  );
}

function OutlineHandles({
  outline,
  px,
  accent,
  selected,
}: {
  outline: [number, number][];
  px: (n: number) => number;
  accent: string;
  selected: number | null;
}) {
  return (
    <g>
      {outline.map(([x, y], i) => {
        const next = outline[(i + 1) % outline.length];
        if (!next || outline.length < 2) return null;
        const mx = (x + next[0]) / 2;
        const my = (y + next[1]) / 2;
        return (
          // Edge midpoints: drag one to add a corner there.
          <g
            key={`m${i}-${x}-${y}`}
            data-t={encode({ t: "mid", index: i })}
            style={{ cursor: "copy" }}
          >
            <circle cx={mx} cy={my} r={px(12)} fill="transparent" />
            <circle
              cx={mx}
              cy={my}
              r={px(5)}
              fill="var(--mantine-color-body)"
              stroke={accent}
              strokeWidth={px(1.5)}
              strokeDasharray={`${px(2)} ${px(2)}`}
            />
          </g>
        );
      })}
      {outline.map(([x, y], i) => (
        <g
          key={`v${i}-${x}-${y}`}
          data-t={encode({ t: "vtx", index: i })}
          style={{ cursor: "move" }}
        >
          <circle cx={x} cy={y} r={px(14)} fill="transparent" />
          <rect
            x={x - px(6)}
            y={y - px(6)}
            width={px(12)}
            height={px(12)}
            fill={selected === i ? accent : "var(--mantine-color-body)"}
            stroke={accent}
            strokeWidth={px(2)}
          />
        </g>
      ))}
    </g>
  );
}

/** A "nice" round length bar, 60–140px long, for a scaled plan. */
function ScaleBar({ mmPerPx, unit }: { mmPerPx: number; unit: LengthUnit }) {
  const steps =
    unit === "ft"
      ? [1, 2, 5, 10, 20, 50, 100, 200, 500].map((ft) => ft * 304.8)
      : [0.5, 1, 2, 5, 10, 20, 50, 100, 200].map((m) => m * 1000);
  const mm = steps.find((s) => s / mmPerPx >= 60) ?? (steps.at(-1) as number);
  const widthPx = mm / mmPerPx;
  if (widthPx > 240) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 10,
        bottom: 8,
        fontSize: 11,
        color: "var(--mantine-color-dimmed)",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: widthPx,
          height: 6,
          borderLeft: "2px solid currentColor",
          borderRight: "2px solid currentColor",
          borderBottom: "2px solid currentColor",
        }}
      />
      {formatLength(mm, unit)}
    </div>
  );
}
