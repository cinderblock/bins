/**
 * Pointer gesture engine for the photo viewer: pinch-zoom, pan, double-tap,
 * and swipe-to-page, arbitrated against each other.
 *
 * The behaviour (and every constant below) is ported from PhotoSwipe's
 * gesture handlers — https://github.com/dimsemenov/PhotoSwipe, MIT, © Dmytro
 * Semenov — rather than adopting the library, which would have replaced the
 * whole modal and its delete-with-undo UI. What's borrowed is the technique;
 * the code is ours and the coordinate system differs (see "Coordinates").
 *
 * The four things worth understanding, all of which are non-obvious and all
 * of which PhotoSwipe gets right:
 *
 * 1. Whether a release pages to the next photo is decided by PROJECTED
 *    velocity, not by distance travelled. A fast flick over 20px means "next";
 *    a slow drag over 150px means "let me look". A distance threshold cannot
 *    tell those apart, and picking one makes half your users wrong.
 * 2. A pinch keeps the point between the fingers pinned under the fingers.
 *    Scaling about the element's centre instead is the single most common
 *    way pinch-zoom feels broken.
 * 3. Pan and page are the same gesture. Dragging a zoomed photo pans it, and
 *    the leftover past its edge feeds the pager — but ONLY when the photo was
 *    already against that edge as the drag began. Without that condition,
 *    panning across a zoomed photo flips to the next one the moment you reach
 *    the edge, which is maddening.
 * 4. Limits resist rather than stop, and spring back on release. A hard stop
 *    reads as a bug; a rubber band reads as an edge.
 *
 * Coordinates: PhotoSwipe pans from the element's top-left. We use CSS
 * `translate(pan) scale(zoom)` about the centre, so pan is a screen-pixel
 * offset of the image's centre from the viewport's centre, and the bounds are
 * symmetric — `±(scaledSize - viewportSize) / 2`, or zero when the image fits.
 * The pinch formula is the same one, rewritten against that origin.
 *
 * Everything here writes transforms straight to the DOM. React owns WHICH
 * photo is showing; it must not re-render per pointermove.
 */
import { type RefObject, useCallback, useEffect, useRef } from "react";

/** Movement (px) before a drag commits to an axis. */
const AXIS_HYSTERESIS = 10;
/** How much of an out-of-bounds drag actually moves. */
const PAN_END_FRICTION = 0.35;
/** How much of an over-maximum pinch actually zooms. */
const UPPER_ZOOM_FRICTION = 0.05;
/** How much of a below-minimum pinch actually zooms. */
const LOWER_ZOOM_FRICTION = 0.15;
/** px/ms at which a flick pages regardless of how far it travelled. */
const MIN_NEXT_SLIDE_SPEED = 0.5;
/** Fraction of velocity kept per ms while coasting (Apple's scroll-view rate). */
const DECELERATION_RATE = 0.995;
/** Velocity is resampled no more often than this, so one stutter can't skew it. */
const VELOCITY_SAMPLE_MS = 50;
/** Two taps within this long, and this close, are a double-tap. */
const DOUBLE_TAP_DELAY = 300;
const MIN_TAP_DISTANCE = 25;
/** Where a double-tap zooms to, capped by what the image can actually show. */
const DOUBLE_TAP_ZOOM = 2.5;
/** Never zoom past this, however large the original is. */
const MAX_ZOOM_CAP = 6;
/** Settle animation. PhotoSwipe uses a velocity-seeded critically-damped
 * spring (dampingRatio 1, naturalFrequency 40); this is a fixed ease-out,
 * which differs only on a hard flick and costs no animation loop. */
const SNAP_MS = 260;
const SNAP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Distance a coasting flick would still travel. */
export function project(velocity: number): number {
  return (velocity * DECELERATION_RATE) / (1 - DECELERATION_RATE);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

interface Point {
  x: number;
  y: number;
}

interface Geometry {
  /** Viewport (the clipping box) size. */
  vw: number;
  vh: number;
  /** Rendered image size at zoom 1 — object-fit: contain, never upscaled. */
  baseW: number;
  baseH: number;
  /** Zoom at which the image hits 1:1 with its own pixels, within limits. */
  maxZoom: number;
}

type Mode = "none" | "drag" | "pinch";
/** "free" = zoomed in, both axes pan; "x"/"y" = axis-locked at zoom 1. */
type Axis = null | "x" | "y" | "free";

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// The borrowed formulas are pulled out as pure functions so they can be
// tested without a browser — multi-touch is the one thing no automation here
// can honestly drive, so the arithmetic is where the confidence has to come
// from. See photoGestures.test.ts.

/**
 * Rendered size and zoom ceiling for an `nw`×`nh` image inside a `vw`×`vh`
 * box. Mirrors the CSS exactly: `object-fit: contain`, never upscaled.
 */
export function fitGeometry(
  nw: number,
  nh: number,
  vw: number,
  vh: number,
): Geometry {
  if (!nw || !nh) return { vw, vh, baseW: 0, baseH: 0, maxZoom: 1 };
  const fit = Math.min(vw / nw, vh / nh, 1);
  const baseW = nw * fit;
  const baseH = nh * fit;
  return {
    vw,
    vh,
    baseW,
    baseH,
    // Past 1:1 with the source pixels there is no more detail to reveal, but
    // allow 2x regardless — people zoom into blurry things on purpose.
    maxZoom: clamp(nw / baseW, 2, MAX_ZOOM_CAP),
  };
}

/** Half the scaled image's overflow past the viewport; 0 when it fits. */
export function panBound(
  baseSize: number,
  viewportSize: number,
  zoom: number,
): number {
  return Math.max(0, (baseSize * zoom - viewportSize) / 2);
}

/** Pinch scale with resistance past either limit, instead of a hard stop. */
export function zoomWithResistance(raw: number, maxZoom: number): number {
  if (raw > maxZoom) return maxZoom + (raw - maxZoom) * UPPER_ZOOM_FRICTION;
  if (raw < 1) return 1 + (raw - 1) * LOWER_ZOOM_FRICTION;
  return raw;
}

/**
 * Pan that keeps whatever was under `startAnchor` under `anchor` while the
 * scale changes by `factor` — PhotoSwipe's
 *   `pan = zoomPoint - (startZoomPoint - startPan) * zoomFactor`
 * with both points taken relative to the viewport centre.
 */
export function anchoredPan(
  anchor: number,
  centre: number,
  startAnchor: number,
  startPan: number,
  factor: number,
): number {
  return anchor - centre - (startAnchor - centre - startPan) * factor;
}

/**
 * Which way a released horizontal drag pages. Projects where the flick would
 * coast to and pages when that clears the halfway mark — or when it was a
 * decisive flick already travelling that way. Distance alone can't tell a
 * flick from a slow look-around, which is the whole point.
 */
export function pageDelta(
  trackX: number,
  velocity: number,
  viewportWidth: number,
): -1 | 0 | 1 {
  const projected = trackX + project(velocity);
  const fast = Math.abs(velocity) >= MIN_NEXT_SLIDE_SPEED;
  if (projected < -viewportWidth / 2 || (fast && velocity < 0 && trackX < 0))
    return 1;
  if (projected > viewportWidth / 2 || (fast && velocity > 0 && trackX > 0))
    return -1;
  return 0;
}

export interface PhotoGestureOptions {
  /** Clipping box that receives the pointer events. */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Flex track holding every slide; slides horizontally. */
  trackRef: RefObject<HTMLDivElement | null>;
  /** The <img> of the slide currently on screen. */
  imgRef: RefObject<HTMLImageElement | null>;
  index: number;
  count: number;
  /** Move by delta slides. Return false if there was nowhere to go. */
  onPage: (delta: number) => boolean;
  enabled: boolean;
}

export function usePhotoGestures({
  viewportRef,
  trackRef,
  imgRef,
  index,
  count,
  onPage,
  enabled,
}: PhotoGestureOptions): { reset: () => void } {
  // Live values the long-lived pointer listeners read. Refs, not closure
  // captures, so the listeners never go stale and never need re-binding.
  const nav = useRef({ index, count, onPage });
  nav.current = { index, count, onPage };

  const state = useRef({
    pointers: new Map<number, Point>(),
    mode: "none" as Mode,
    axis: null as Axis,
    start: { x: 0, y: 0 } as Point,
    startPan: { x: 0, y: 0 } as Point,
    startZoom: 1,
    startDistance: 0,
    startMid: { x: 0, y: 0 } as Point,
    geometry: null as Geometry | null,
    // The transform actually on screen.
    zoom: 1,
    pan: { x: 0, y: 0 } as Point,
    trackX: 0,
    velocity: 0,
    sampleTime: 0,
    sampleX: 0,
    lastTapTime: 0,
    lastTapPos: { x: 0, y: 0 } as Point,
  }).current;

  const reset = useCallback(() => {
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };
    state.trackX = 0;
    state.mode = "none";
    state.axis = null;
    state.pointers.clear();
  }, [state]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !enabled) return;

    /** Image geometry, sampled once per gesture — it can't change mid-drag. */
    const measure = (): Geometry => {
      const rect = viewport.getBoundingClientRect();
      const img = imgRef.current;
      return fitGeometry(
        img?.naturalWidth ?? 0,
        img?.naturalHeight ?? 0,
        rect.width,
        rect.height,
      );
    };

    /** Viewport centre in client coordinates — the origin pan is measured from. */
    const centre = (): Point => {
      const rect = viewport.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    /** How far the image can move before its edge comes inside the viewport. */
    const panBounds = (geometry: Geometry, zoom: number): Point => ({
      x: panBound(geometry.baseW, geometry.vw, zoom),
      y: panBound(geometry.baseH, geometry.vh, zoom),
    });

    const apply = (animate: boolean) => {
      const transition = animate
        ? `transform ${SNAP_MS}ms ${SNAP_EASING}`
        : "none";
      const track = trackRef.current;
      if (track) {
        track.style.transition = transition;
        track.style.transform = `translate3d(calc(${-nav.current.index * 100}% + ${state.trackX}px), 0, 0)`;
      }
      const img = imgRef.current;
      if (img) {
        img.style.transition = transition;
        img.style.transform = `translate3d(${state.pan.x}px, ${state.pan.y}px, 0) scale(${state.zoom})`;
      }
    };

    const beginDrag = (x: number, y: number) => {
      state.mode = "drag";
      // Zoomed in, both axes pan; at rest, the drag has to pick an axis first.
      state.axis = state.zoom > 1.01 ? "free" : null;
      state.start = { x, y };
      state.startPan = { ...state.pan };
      state.geometry = measure();
      state.velocity = 0;
      state.sampleTime = performance.now();
      state.sampleX = x;
      apply(false);
    };

    const beginPinch = () => {
      const [a, b] = [...state.pointers.values()];
      if (!a || !b) return;
      state.mode = "pinch";
      state.startDistance = distance(a, b);
      state.startMid = midpoint(a, b);
      state.startZoom = state.zoom;
      state.startPan = { ...state.pan };
      state.geometry = measure();
      apply(false);
    };

    /** Rubber-band the pager once there's no slide left in that direction. */
    const pagerOffset = (raw: number): number => {
      const { index: i, count: n } = nav.current;
      const atEnd = (raw > 0 && i <= 0) || (raw < 0 && i >= n - 1);
      return atEnd ? raw * PAN_END_FRICTION : raw;
    };

    const doPinch = () => {
      const geometry = state.geometry;
      const [a, b] = [...state.pointers.values()];
      if (!geometry || !a || !b || !state.startDistance) return;

      const raw = state.startZoom * (distance(a, b) / state.startDistance);
      // Resist past the limits instead of stopping dead; settle() springs back.
      const zoom = zoomWithResistance(raw, geometry.maxZoom);

      // Keep whatever was between the fingers between the fingers.
      const mid = midpoint(a, b);
      const c = centre();
      const factor = zoom / state.startZoom;
      state.zoom = zoom;
      state.pan = {
        x: anchoredPan(mid.x, c.x, state.startMid.x, state.startPan.x, factor),
        y: anchoredPan(mid.y, c.y, state.startMid.y, state.startPan.y, factor),
      };
      apply(false);
    };

    const doDrag = (x: number, y: number) => {
      const dx = x - state.start.x;
      const dy = y - state.start.y;

      if (state.axis === null) {
        if (Math.abs(dx) < AXIS_HYSTERESIS && Math.abs(dy) < AXIS_HYSTERESIS)
          return;
        state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }

      const now = performance.now();
      if (now - state.sampleTime > VELOCITY_SAMPLE_MS) {
        state.velocity = (x - state.sampleX) / (now - state.sampleTime);
        state.sampleTime = now;
        state.sampleX = x;
      }

      // A vertical drag at rest isn't ours — leave the photo alone.
      if (state.axis === "y") return;

      const geometry = state.geometry;
      if (state.axis === "free" && geometry) {
        const bounds = panBounds(geometry, state.zoom);
        const wantX = state.startPan.x + dx;
        const panX = clamp(wantX, -bounds.x, bounds.x);
        // The leftover pages to the next photo, but only if the image was
        // ALREADY against this edge when the drag started. Otherwise a pan
        // across a zoomed photo would flip photos the instant it hit the edge.
        const startedAtEdge =
          (wantX > panX && state.startPan.x >= bounds.x - 1) ||
          (wantX < panX && state.startPan.x <= -bounds.x + 1);
        state.pan = {
          x: panX,
          y: clamp(state.startPan.y + dy, -bounds.y, bounds.y),
        };
        state.trackX = startedAtEdge ? pagerOffset(wantX - panX) : 0;
      } else {
        state.pan = { x: 0, y: 0 };
        state.trackX = pagerOffset(dx);
      }
      apply(false);
    };

    /** Pull zoom back inside its limits and the pan inside the bounds. */
    const settle = () => {
      const geometry = state.geometry;
      if (geometry) {
        state.zoom = clamp(state.zoom, 1, geometry.maxZoom);
        const bounds = panBounds(geometry, state.zoom);
        state.pan = {
          x: clamp(state.pan.x, -bounds.x, bounds.x),
          y: clamp(state.pan.y, -bounds.y, bounds.y),
        };
      } else {
        state.zoom = 1;
        state.pan = { x: 0, y: 0 };
      }
      state.trackX = 0;
      apply(true);
    };

    const toggleZoom = (x: number, y: number) => {
      const geometry = state.geometry ?? measure();
      state.geometry = geometry;
      const target =
        state.zoom > 1.01 ? 1 : Math.min(DOUBLE_TAP_ZOOM, geometry.maxZoom);
      if (target === 1) {
        state.zoom = 1;
        state.pan = { x: 0, y: 0 };
      } else {
        // Same anchor-preserving formula as the pinch, anchored on the tap.
        const c = centre();
        const factor = target / state.zoom;
        const bounds = panBounds(geometry, target);
        state.pan = {
          x: clamp(
            anchoredPan(x, c.x, x, state.pan.x, factor),
            -bounds.x,
            bounds.x,
          ),
          y: clamp(
            anchoredPan(y, c.y, y, state.pan.y, factor),
            -bounds.y,
            bounds.y,
          ),
        };
        state.zoom = target;
      }
      state.trackX = 0;
      apply(true);
    };

    const finish = (event: PointerEvent) => {
      const { mode, axis } = state;
      state.mode = "none";
      state.axis = null;

      const travelled = Math.hypot(
        event.clientX - state.start.x,
        event.clientY - state.start.y,
      );

      if (mode === "drag" && travelled < MIN_TAP_DISTANCE) {
        const now = performance.now();
        const near =
          distance({ x: event.clientX, y: event.clientY }, state.lastTapPos) <
          MIN_TAP_DISTANCE;
        if (now - state.lastTapTime < DOUBLE_TAP_DELAY && near) {
          state.lastTapTime = 0;
          toggleZoom(event.clientX, event.clientY);
          return;
        }
        state.lastTapTime = now;
        state.lastTapPos = { x: event.clientX, y: event.clientY };
        settle();
        return;
      }

      // Horizontal release: where would this flick COAST to? Distance alone
      // can't tell a decisive flick from a slow look-around.
      if (axis === "x" || (axis === "free" && state.trackX !== 0)) {
        const vw = state.geometry?.vw || viewport.clientWidth || 1;
        const delta = pageDelta(state.trackX, state.velocity, vw);
        if (delta !== 0 && nav.current.onPage(delta)) {
          // React re-renders at the new index and animates there; the photo we
          // came from springs back to rest on its way out.
          reset();
          return;
        }
      }
      settle();
    };

    const onPointerDown = (event: PointerEvent) => {
      // The pager arrows sit inside the viewport and own their own taps.
      if ((event.target as HTMLElement | null)?.closest("button")) return;
      state.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      viewport.setPointerCapture(event.pointerId);
      if (state.pointers.size === 1) beginDrag(event.clientX, event.clientY);
      else if (state.pointers.size === 2) beginPinch();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!state.pointers.has(event.pointerId)) return;
      state.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (state.mode === "pinch" && state.pointers.size >= 2) doPinch();
      else if (state.mode === "drag") doDrag(event.clientX, event.clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!state.pointers.has(event.pointerId)) return;
      state.pointers.delete(event.pointerId);
      if (viewport.hasPointerCapture(event.pointerId))
        viewport.releasePointerCapture(event.pointerId);

      if (state.pointers.size === 1) {
        // Down to one finger: re-baseline on it, or the image jumps by
        // however far apart the two fingers were.
        const remaining = [...state.pointers.values()][0];
        if (remaining) beginDrag(remaining.x, remaining.y);
        return;
      }
      if (state.pointers.size > 0) return;
      finish(event);
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerUp);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerUp);
    };
  }, [enabled, viewportRef, trackRef, imgRef, state, reset]);

  return { reset };
}
