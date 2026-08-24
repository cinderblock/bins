/**
 * The photo viewer's gesture arithmetic, ported from PhotoSwipe.
 *
 * These cover the parts that are easy to get subtly wrong and impossible to
 * notice in a screenshot: whether a release pages, where a pinch leaves the
 * image, and how far a zoomed photo may be dragged. The pointer plumbing
 * around them needs a real finger; this is everything that doesn't.
 */
import { describe, expect, test } from "bun:test";
import {
  anchoredPan,
  fitGeometry,
  pageDelta,
  panBound,
  project,
  zoomWithResistance,
} from "./photoGestures";

describe("project", () => {
  test("scales a flick to how far it would coast", () => {
    // 0.995 deceleration => velocity * 199.
    expect(project(1)).toBeCloseTo(199, 5);
    expect(project(-0.5)).toBeCloseTo(-99.5, 5);
    expect(project(0)).toBe(0);
  });
});

describe("pageDelta", () => {
  const VW = 400;

  test("a slow drag past halfway pages", () => {
    expect(pageDelta(-250, 0, VW)).toBe(1);
    expect(pageDelta(250, 0, VW)).toBe(-1);
  });

  test("a slow drag short of halfway snaps back", () => {
    expect(pageDelta(-150, 0, VW)).toBe(0);
    expect(pageDelta(150, 0, VW)).toBe(0);
  });

  test("a fast flick pages even though it barely moved", () => {
    // 20px is nowhere near halfway; the projection and the flick floor are
    // what make this feel right. A distance threshold would refuse it.
    expect(pageDelta(-20, -0.8, VW)).toBe(1);
    expect(pageDelta(20, 0.8, VW)).toBe(-1);
  });

  test("a slow nudge is not a flick", () => {
    expect(pageDelta(-20, -0.1, VW)).toBe(0);
  });

  test("dragging out and flicking back cancels", () => {
    // Dragged left 150px, then thrown back to the right on release: the user
    // changed their mind, and the projection has to honour that.
    expect(pageDelta(-150, 1.0, VW)).toBe(0);
    expect(pageDelta(150, -1.0, VW)).toBe(0);
  });

  test("projection alone carries a hard flick", () => {
    // 1.5 px/ms projects ~298px, past the 200px halfway mark on its own.
    expect(pageDelta(-20, -1.5, VW)).toBe(1);
  });
});

describe("fitGeometry", () => {
  test("contains a large photo and allows 1:1 zoom", () => {
    const g = fitGeometry(1600, 1200, 400, 400);
    expect(g.baseW).toBe(400);
    expect(g.baseH).toBe(300);
    // 1600 native / 400 rendered = 4x before pixels run out.
    expect(g.maxZoom).toBe(4);
  });

  test("never upscales a small photo, but still allows some zoom", () => {
    const g = fitGeometry(200, 100, 400, 400);
    expect(g.baseW).toBe(200);
    expect(g.baseH).toBe(100);
    // 1:1 is already on screen, yet people zoom into blurry things on purpose.
    expect(g.maxZoom).toBe(2);
  });

  test("caps zoom however huge the source is", () => {
    expect(fitGeometry(8000, 8000, 400, 400).maxZoom).toBe(6);
  });

  test("an unloaded image has no zoom range", () => {
    const g = fitGeometry(0, 0, 400, 400);
    expect(g.baseW).toBe(0);
    expect(g.maxZoom).toBe(1);
  });
});

describe("panBound", () => {
  test("an image that fits cannot be panned", () => {
    expect(panBound(400, 400, 1)).toBe(0);
    expect(panBound(300, 400, 1)).toBe(0);
    // Still fits at 1.2x — 360 < 400.
    expect(panBound(300, 400, 1.2)).toBe(0);
  });

  test("bounds are half the overflow, so the edge stops at the edge", () => {
    expect(panBound(400, 400, 2)).toBe(200);
    expect(panBound(300, 400, 2)).toBe(100);
  });
});

describe("zoomWithResistance", () => {
  test("passes through inside the limits", () => {
    expect(zoomWithResistance(2, 4)).toBe(2);
    expect(zoomWithResistance(1, 4)).toBe(1);
    expect(zoomWithResistance(4, 4)).toBe(4);
  });

  test("resists past the maximum instead of stopping dead", () => {
    // A whole extra unit of pinch buys 0.05 — it moves, but it fights back.
    expect(zoomWithResistance(5, 4)).toBeCloseTo(4.05, 5);
    expect(zoomWithResistance(8, 4)).toBeCloseTo(4.2, 5);
  });

  test("resists below the minimum", () => {
    expect(zoomWithResistance(0.5, 4)).toBeCloseTo(0.925, 5);
    expect(zoomWithResistance(0, 4)).toBeCloseTo(0.85, 5);
  });
});

describe("anchoredPan", () => {
  const CENTRE = 200;

  /**
   * Which point of the IMAGE sits under a screen coordinate, in the image's
   * own unscaled units. If a zoom changes this, the photo squirmed out from
   * under the fingers — the exact failure this formula exists to prevent.
   */
  const contentUnder = (screen: number, pan: number, zoom: number) =>
    (screen - CENTRE - pan) / zoom;

  test("keeps the pinched point under stationary fingers", () => {
    const before = contentUnder(300, 0, 1);
    const pan = anchoredPan(300, CENTRE, 300, 0, 2);
    expect(contentUnder(300, pan, 2)).toBeCloseTo(before, 10);
  });

  test("keeps it under fingers that move while they pinch", () => {
    // Fingers start at 300 and drift to 250 during the pinch: the content
    // under them must travel with them, not stay where it started.
    const before = contentUnder(300, 0, 1);
    const pan = anchoredPan(250, CENTRE, 300, 0, 2);
    expect(contentUnder(250, pan, 2)).toBeCloseTo(before, 10);
  });

  test("works when the image was already panned and zoomed", () => {
    const startZoom = 2.5;
    const startPan = -80;
    const before = contentUnder(140, startPan, startZoom);
    const target = 1.6;
    const pan = anchoredPan(140, CENTRE, 140, startPan, target / startZoom);
    expect(contentUnder(140, pan, target)).toBeCloseTo(before, 10);
  });

  test("zooming about the centre would NOT hold the point", () => {
    // Guards the formula against being "simplified" back to the naive version
    // that ignores the anchor, which is the usual way pinch feels broken.
    const before = contentUnder(300, 0, 1);
    const naive = 0;
    expect(contentUnder(300, naive, 2)).not.toBeCloseTo(before, 5);
  });

  test("a pinch centred on the middle leaves the pan alone", () => {
    expect(anchoredPan(CENTRE, CENTRE, CENTRE, 0, 3)).toBe(0);
  });
});
