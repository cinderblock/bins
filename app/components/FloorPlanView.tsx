/**
 * A space's floor plan, full size: the map a person reads, and — for an
 * admin who asks — the editor they arrange it with.
 *
 * Reading: colour the shelving by how full it is or by what's in it, tap a
 * wall to see what it holds and open its elevation, and follow a "where is
 * this box" highlight from anywhere else in the app.
 *
 * Editing lives on the same drawing, behind a pencil in the map's own corner
 * (layouts change about as often as places do — see the "rare actions don't
 * go in headers" rule in plans/wide-screens-and-direct-edits.md). Everything
 * draggable is also typeable in the inspector, so no edit depends on a
 * pointer: a phone, a keyboard, or a trackpad all get there.
 *
 * Writes are one op per FINISHED gesture. While a drag is in flight the
 * change lives in `drafts`; once written it stays drafted until the replica
 * reflects it, so nothing flickers back for a frame.
 */
import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  Group,
  Menu,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useComputedColorScheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  LANDMARK_DEFAULTS,
  LANDMARK_KINDS,
  type LandmarkKind,
  MIN_LENGTH_MM,
  type Point,
  childrenIn,
  defaultFootprint,
  landmarkKind,
  normalizeAngle,
  planBounds,
  rectOutline,
  sanitizeLayout,
  sanitizePlan,
  snapAngle,
  snapTo,
  snapVertex,
  toLocal,
  toParent,
} from "@shared/floorplan";
import { locationLabel } from "@shared/locations";
import type { Landmark, PlaceLayout, PlacePlan } from "@shared/ops";
import type { BinState, LocationState } from "@shared/reducer";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconRotate2,
  IconRotateClockwise2,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  type ColorBy,
  type DragHandler,
  type FloorPlanHandle,
  FloorPlanSvg,
  type Selection,
  type Target,
} from "~/components/FloorPlanSvg";
import { LengthField } from "~/components/LengthField";
import { PlaceEditSheet } from "~/components/PlaceEditSheet";
import { setPlaceLayout, setPlacePlan } from "~/lib/actions";
import { useAdminPassword } from "~/lib/admin";
import { boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import {
  FULLNESS_LEGEND,
  FULLNESS_RAMP,
  OVER_COLOR,
  type PlanData,
  type SceneItem,
  buildScene,
  fullnessClass,
  mapTargetFor,
  usePlanData,
} from "~/lib/floorplan";
import {
  type LengthUnit,
  getLengthUnit,
  gridLineStep,
  setLengthUnit,
  snapStep,
} from "~/lib/lengths";
import { describeBinLocation } from "~/lib/places";
import { PHONE_MEDIA } from "~/lib/ui";

const COLOR_BY_KEY = "bins.planColorBy";

/** What a map or an elevation should point at. */
export type PointAt = { bin?: BinState; placeId?: string };

function storedColorBy(): ColorBy {
  if (typeof localStorage === "undefined") return "fullness";
  const v = localStorage.getItem(COLOR_BY_KEY);
  return v === "category" || v === "none" ? v : "fullness";
}

/** A change the editor made, as the value before and after — for undo. */
type Change =
  | {
      kind: "layout";
      id: string;
      before: PlaceLayout | null;
      after: PlaceLayout | null;
    }
  | { kind: "plan"; before: PlacePlan | null; after: PlacePlan | null };

/** How long a written edit may stay drafted waiting for the replica. */
const DRAFT_GRACE_MS = 2500;

type Draft<T> = { value: T; until: number | null };

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function FloorPlanView({
  space: given,
  pointAt,
  startEditing = false,
  onOpenPlace,
  onClearFind,
}: {
  space: LocationState;
  /**
   * Something to point at: a box (from a "show on map" link) or a place (a
   * shelf just scanned in put-away). `bin` wins when both are given.
   */
  pointAt: PointAt | null;
  startEditing?: boolean;
  /** Open a place: its elevation, or its own map when it is a space. */
  onOpenPlace: (placeId: string, pointAt?: PointAt) => void;
  onClearFind: () => void;
}) {
  const data = usePlanData();
  // Read the space from THIS component's replica query, never the caller's.
  // Two live queries update at different moments; drafts are retired by
  // comparing against `data`, so drawing from the caller's copy showed a
  // just-retired draft's OLD value for a beat — and the next edit, built on
  // that, silently threw the previous one away (an outline lost to a door).
  const space = data.byId.get(given.id) ?? given;
  const scheme = useComputedColorScheme("dark");
  const phone = useMediaQuery(PHONE_MEDIA) ?? false;
  const unlocked = typeof useAdminPassword() === "string";
  const numbersInternal = useBoxNumbersInternal();
  const svg = useRef<FloorPlanHandle>(null);

  const [colorBy, setColorBy] = useState<ColorBy>(storedColorBy);
  const [unit, setUnit] = useState<LengthUnit>(getLengthUnit);
  const [editing, setEditing] = useState(false);
  // Arriving from "create and arrange" opens the editor — once, and only
  // after the admin check has loaded (it is async; on the first render
  // `unlocked` is still false).
  const openedEditor = useRef(false);
  useEffect(() => {
    if (!startEditing || !unlocked || openedEditor.current) return;
    openedEditor.current = true;
    setEditing(true);
  }, [startEditing, unlocked]);
  const [outlineEditing, setOutlineEditing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [focus, setFocus] = useState<{
    itemId: string;
    bayId: string | null;
  } | null>(null);
  const [editPlace, setEditPlace] = useState<LocationState | null>(null);

  // ── Drafts: what the drawing shows ahead of the replica ──
  const [layoutDrafts, setLayoutDrafts] = useState<
    Map<string, Draft<PlaceLayout | null>>
  >(() => new Map());
  const [planDraft, setPlanDraft] = useState<Draft<PlacePlan | null> | null>(
    null,
  );
  const [undo, setUndo] = useState<Change[][]>([]);
  const [redo, setRedo] = useState<Change[][]>([]);

  // Drop a draft once the replica agrees with it, or once its grace is up
  // (someone else's later write won — show theirs).
  useEffect(() => {
    const now = Date.now();
    let changed = false;
    const next = new Map(layoutDrafts);
    for (const [id, d] of layoutDrafts) {
      if (d.until === null) continue;
      const stored = data.byId.get(id)?.layout ?? null;
      if (same(stored, d.value) || now > d.until) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) setLayoutDrafts(next);
    if (planDraft && planDraft.until !== null) {
      const stored = data.byId.get(space.id)?.plan ?? null;
      if (same(stored, planDraft.value) || now > planDraft.until)
        setPlanDraft(null);
    }
    const pending = [
      ...layoutDrafts.values(),
      ...(planDraft ? [planDraft] : []),
    ]
      .map((d) => d.until)
      .filter((u): u is number => u !== null);
    if (!pending.length) return;
    const wait = Math.max(50, Math.min(...pending) - now + 10);
    const timer = setTimeout(() => setLayoutDrafts((m) => new Map(m)), wait);
    return () => clearTimeout(timer);
  }, [data.byId, layoutDrafts, planDraft, space.id]);

  const drafts = {
    layouts: new Map([...layoutDrafts].map(([id, d]) => [id, d.value])),
    plan: planDraft ? planDraft.value : undefined,
  };
  const { scene, unplaced } = buildScene(space, data, drafts);
  const plan: PlacePlan = {
    scaled: scene.scaled,
    outline: scene.outline,
    landmarks: scene.landmarks,
  };
  const hasPlan = planDraft ? planDraft.value !== null : space.plan !== null;
  const step = snapStep(scene.scaled, unit);

  // ── Writing ──
  function storedLayout(id: string): PlaceLayout | null {
    const d = layoutDrafts.get(id);
    if (d) return d.value;
    return data.byId.get(id)?.layout ?? null;
  }
  function storedPlan(): PlacePlan | null {
    return planDraft ? planDraft.value : (space.plan ?? null);
  }

  async function apply(raw: Change[], record: "undo" | "redo" | null) {
    // Sanitize ONCE, up front: the draft, the undo record and the op must
    // all hold the same value, or a draft never matches what was stored
    // and lingers until its grace runs out.
    const changes: Change[] = raw.map((c) =>
      c.kind === "layout"
        ? { ...c, after: c.after && sanitizeLayout(c.after) }
        : { ...c, after: c.after && sanitizePlan(c.after) },
    );
    const until = Date.now() + DRAFT_GRACE_MS;
    setLayoutDrafts((m) => {
      const next = new Map(m);
      for (const c of changes)
        if (c.kind === "layout") next.set(c.id, { value: c.after, until });
      return next;
    });
    const planChange = [...changes].reverse().find((c) => c.kind === "plan");
    if (planChange) setPlanDraft({ value: planChange.after, until });
    if (record === "undo") {
      setUndo((u) => [...u.slice(-99), changes]);
      setRedo([]);
    }
    for (const c of changes) {
      if (c.kind === "layout") await setPlaceLayout(c.id, c.after);
      else await setPlacePlan(space.id, c.after);
    }
  }

  function writeLayout(id: string, after: PlaceLayout | null) {
    return apply(
      [{ kind: "layout", id, before: storedLayout(id), after }],
      "undo",
    );
  }
  function writePlan(after: PlacePlan | null) {
    return apply([{ kind: "plan", before: storedPlan(), after }], "undo");
  }

  function doUndo() {
    const last = undo.at(-1);
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    setRedo((r) => [...r, last]);
    void apply(
      [...last]
        .reverse()
        .map((c) => ({ ...c, before: c.after, after: c.before }) as Change),
      null,
    );
  }
  function doRedo() {
    const last = redo.at(-1);
    if (!last) return;
    setRedo((r) => r.slice(0, -1));
    setUndo((u) => [...u, last]);
    void apply(last, null);
  }

  // ── Finding a box ──
  const pointedPlace = pointAt?.bin
    ? pointAt.bin.locationId
    : (pointAt?.placeId ?? null);
  const target = pointAt ? mapTargetFor(data, pointedPlace) : null;
  const highlight =
    target && target.space.id === space.id && target.item
      ? { itemId: target.item.id, bayId: target.bay?.id ?? null }
      : null;

  // ── Gestures ──
  const itemById = (id: string) => scene.items.find((i) => i.place.id === id);
  const landmarkById = (id: string) => plan.landmarks.find((l) => l.id === id);

  function setLandmark(next: Landmark | null, id: string) {
    const landmarks = plan.landmarks
      .map((l) => (l.id === id ? next : l))
      .filter((l): l is Landmark => l !== null);
    return { ...plan, landmarks };
  }

  /** A footprint drag (move / rotate / resize) shared by items and landmarks. */
  function footprintDrag(
    base: PlaceLayout,
    target: Target,
    start: Point,
    show: (f: PlaceLayout) => void,
    commit: (f: PlaceLayout) => void,
    revert: () => void,
  ): DragHandler {
    const offset = { x: start.x - base.x, y: start.y - base.y };
    let current = base;
    const move = (world: Point, e: PointerEvent) => {
      const free = e.altKey;
      const s = (v: number) => (free ? v : snapTo(v, step));
      if (target.t === "rot") {
        const deg =
          (Math.atan2(world.y - base.y, world.x - base.x) * 180) / Math.PI + 90;
        current = {
          ...base,
          rotation: free ? normalizeAngle(deg) : snapAngle(deg),
        };
      } else if (target.t === "size") {
        const local = toLocal(base, world);
        if (target.edge === "back") {
          const front = base.depth / 2;
          const back = Math.min(s(local.y), front - MIN_LENGTH_MM);
          const c = toParent(base, { x: 0, y: (front + back) / 2 });
          current = { ...base, x: c.x, y: c.y, depth: front - back };
        } else {
          const right = target.edge === "right";
          const fixed = right ? -base.width / 2 : base.width / 2;
          const moving = right
            ? Math.max(s(local.x), fixed + MIN_LENGTH_MM)
            : Math.min(s(local.x), fixed - MIN_LENGTH_MM);
          const c = toParent(base, { x: (fixed + moving) / 2, y: 0 });
          current = {
            ...base,
            x: c.x,
            y: c.y,
            width: Math.abs(moving - fixed),
          };
        }
      } else {
        current = {
          ...base,
          x: s(world.x - offset.x),
          y: s(world.y - offset.y),
        };
      }
      show(current);
    };
    return {
      move,
      end: () => {
        if (!same(current, base)) commit(current);
        else revert();
      },
      cancel: revert,
    };
  }

  function onDragStart(target: Target, start: Point): DragHandler | null {
    if (!editing) return null;
    if (
      target.t === "item" ||
      (target.t !== "lm" && "of" in target && target.of === "item")
    ) {
      const id = target.id;
      const item = itemById(id);
      if (!item) return null;
      setSelection({ t: "item", id });
      const before = storedLayout(id);
      return footprintDrag(
        item.layout,
        target,
        start,
        (f) =>
          setLayoutDrafts((m) => new Map(m).set(id, { value: f, until: null })),
        (f) => void apply([{ kind: "layout", id, before, after: f }], "undo"),
        () =>
          setLayoutDrafts((m) => {
            const next = new Map(m);
            next.delete(id);
            return next;
          }),
      );
    }
    if (target.t === "lm" || ("of" in target && target.of === "lm")) {
      const id = target.id;
      const lm = landmarkById(id);
      if (!lm) return null;
      setSelection({ t: "lm", id });
      const before = storedPlan();
      const asLayout = { ...lm, parentId: space.id };
      const toLandmark = (f: PlaceLayout): Landmark => ({
        ...lm,
        x: f.x,
        y: f.y,
        rotation: f.rotation,
        width: f.width,
        depth: f.depth,
      });
      return footprintDrag(
        asLayout,
        target,
        start,
        (f) =>
          setPlanDraft({ value: setLandmark(toLandmark(f), id), until: null }),
        (f) =>
          void apply(
            [{ kind: "plan", before, after: setLandmark(toLandmark(f), id) }],
            "undo",
          ),
        () => setPlanDraft(null),
      );
    }
    if (target.t === "vtx" || target.t === "mid") {
      if (!outlineEditing) return null;
      const before = storedPlan();
      const outline = [...plan.outline];
      let index = target.index;
      if (target.t === "mid") {
        // Dragging an edge's midpoint splits the edge there.
        index = target.index + 1;
        outline.splice(index, 0, [start.x, start.y]);
      }
      setSelection({ t: "vtx", index });
      let current = outline;
      const tolerance = step * 0.75;
      return {
        move: (world, e) => {
          const p = e.altKey
            ? world
            : snapVertex(outline, index, world, step, tolerance);
          current = outline.map((v, i) => (i === index ? [p.x, p.y] : v));
          setPlanDraft({ value: { ...plan, outline: current }, until: null });
        },
        end: () => {
          if (!same(current, before?.outline))
            void apply(
              [{ kind: "plan", before, after: { ...plan, outline: current } }],
              "undo",
            );
          else setPlanDraft(null);
        },
        cancel: () => setPlanDraft(null),
      };
    }
    return null;
  }

  function onTap(target: Target | null) {
    if (editing) {
      if (target?.t === "item") setSelection({ t: "item", id: target.id });
      else if (target?.t === "lm") setSelection({ t: "lm", id: target.id });
      else if (target?.t === "vtx")
        setSelection({ t: "vtx", index: target.index });
      else if (!target) setSelection(null);
      return;
    }
    if (target?.t === "item")
      setFocus({ itemId: target.id, bayId: target.bayId });
    else setFocus(null);
  }

  // ── Placing things ──
  function place(p: LocationState) {
    const c = svg.current?.center() ?? { x: 0, y: 0 };
    const size = defaultFootprint(data.index, p);
    const layout: PlaceLayout = {
      parentId: space.id,
      x: snapTo(c.x, step),
      y: snapTo(c.y, step),
      rotation: 0,
      ...size,
    };
    setSelection({ t: "item", id: p.id });
    void writeLayout(p.id, layout);
  }

  function addLandmark(kind: LandmarkKind) {
    const c = svg.current?.center() ?? { x: 0, y: 0 };
    const d = LANDMARK_DEFAULTS[kind];
    const lm: Landmark = {
      id: crypto.randomUUID(),
      kind,
      label: d.label,
      x: snapTo(c.x, step),
      y: snapTo(c.y, step),
      rotation: 0,
      width: d.width,
      depth: d.depth,
    };
    setSelection({ t: "lm", id: lm.id });
    void writePlan({ ...plan, landmarks: [...plan.landmarks, lm] });
  }

  function startOutline() {
    // Wrap whatever is already placed, with room to walk around it; with
    // nothing placed, a modest room around the middle of the view.
    const b = planBounds(
      null,
      scene.items.map((i) => i.layout),
    );
    const c = svg.current?.center() ?? { x: 0, y: 0 };
    const margin = 1500;
    const r = b
      ? {
          minX: snapTo(b.minX - margin, step),
          minY: snapTo(b.minY - margin, step),
          maxX: snapTo(b.maxX + margin, step),
          maxY: snapTo(b.maxY + margin, step),
        }
      : {
          minX: snapTo(c.x - 5000, step),
          minY: snapTo(c.y - 3000, step),
          maxX: snapTo(c.x + 5000, step),
          maxY: snapTo(c.y + 3000, step),
        };
    setOutlineEditing(true);
    void writePlan({ ...plan, outline: rectOutline(r) });
  }

  // ── Keyboard (editing only) ──
  const keyState = useRef({ selection, plan, scene, step });
  keyState.current = { selection, plan, scene, step };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads live state via keyState
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.getAttribute("contenteditable"))
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
        return;
      }
      const { selection: sel, step: st } = keyState.current;
      if (!sel) return;
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }
      const nudge = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[e.key];
      if (nudge) {
        e.preventDefault();
        const k = (e.shiftKey ? 10 : 1) * st;
        transform(sel, (f) => ({
          ...f,
          x: f.x + (nudge[0] ?? 0) * k,
          y: f.y + (nudge[1] ?? 0) * k,
        }));
      } else if (e.key === "r" || e.key === "R") {
        transform(sel, (f) => ({
          ...f,
          rotation: normalizeAngle(f.rotation + (e.shiftKey ? -90 : 90)),
        }));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(sel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undo, redo, layoutDrafts, planDraft, data]);

  /** Apply a footprint change to whatever is selected. */
  function transform(
    sel: Selection,
    fn: (f: {
      x: number;
      y: number;
      rotation: number;
      width: number;
      depth: number;
    }) => {
      x: number;
      y: number;
      rotation: number;
      width: number;
      depth: number;
    },
  ) {
    if (sel.t === "item") {
      const item = itemById(sel.id);
      if (item)
        void writeLayout(sel.id, { ...item.layout, ...fn(item.layout) });
    } else if (sel.t === "lm") {
      const lm = landmarkById(sel.id);
      if (lm) void writePlan(setLandmark({ ...lm, ...fn(lm) }, sel.id));
    } else if (sel.t === "vtx") {
      const v = plan.outline[sel.index];
      if (!v) return;
      const moved = fn({ x: v[0], y: v[1], rotation: 0, width: 1, depth: 1 });
      void writePlan({
        ...plan,
        outline: plan.outline.map((p, i) =>
          i === sel.index ? [moved.x, moved.y] : p,
        ),
      });
    }
  }

  function remove(sel: Selection) {
    if (sel.t === "item") void writeLayout(sel.id, null);
    else if (sel.t === "lm") void writePlan(setLandmark(null, sel.id));
    else if (sel.t === "vtx" && plan.outline.length > 3)
      void writePlan({
        ...plan,
        outline: plan.outline.filter((_, i) => i !== sel.index),
      });
    setSelection(null);
  }

  // ── Layout of the page ──
  const selectedItem =
    selection?.t === "item" ? itemById(selection.id) : undefined;
  const selectedLandmark =
    selection?.t === "lm" ? landmarkById(selection.id) : undefined;
  const focusedItem = focus ? itemById(focus.itemId) : undefined;
  const empty = scene.items.length === 0 && scene.outline.length === 0;

  const overlay = (
    <Group gap={6} wrap="nowrap">
      {unlocked && !editing && (
        <ActionIcon
          variant="default"
          aria-label="Arrange this floor plan"
          onClick={() => {
            setEditing(true);
            setFocus(null);
          }}
        >
          <IconPencil size={16} />
        </ActionIcon>
      )}
      {editing && (
        <>
          <Button
            size="compact-sm"
            leftSection={<IconCheck size={14} />}
            onClick={() => {
              setEditing(false);
              setOutlineEditing(false);
              setSelection(null);
            }}
          >
            Done
          </Button>
          <ActionIcon
            variant="default"
            aria-label="Undo"
            disabled={!undo.length}
            onClick={doUndo}
          >
            <IconArrowBackUp size={16} />
          </ActionIcon>
          <ActionIcon
            variant="default"
            aria-label="Redo"
            disabled={!redo.length}
            onClick={doRedo}
          >
            <IconArrowForwardUp size={16} />
          </ActionIcon>
        </>
      )}
    </Group>
  );

  const map = (
    <FloorPlanSvg
      handle={svg}
      scene={scene}
      colorBy={colorBy}
      scheme={scheme}
      highlight={highlight}
      focus={editing ? null : focus}
      selection={editing ? selection : null}
      editing={editing}
      outlineEditing={editing && outlineEditing}
      gridStep={editing ? gridLineStep(scene.scaled, unit) : null}
      unit={unit}
      height={phone ? "62vh" : "min(72vh, 760px)"}
      onTap={onTap}
      onDragStart={onDragStart}
      fitKey={space.id}
      overlay={overlay}
    />
  );

  const side = editing ? (
    <EditorPanel
      space={space}
      data={data}
      plan={plan}
      hasPlan={hasPlan}
      unplaced={unplaced}
      unit={unit}
      setUnit={(u) => {
        setLengthUnit(u);
        setUnit(u);
      }}
      outlineEditing={outlineEditing}
      setOutlineEditing={setOutlineEditing}
      selection={selection}
      selectedItem={selectedItem}
      selectedLandmark={selectedLandmark}
      onPlace={place}
      onAddLandmark={addLandmark}
      onStartOutline={startOutline}
      writeLayout={writeLayout}
      writePlan={writePlan}
      apply={apply}
      storedLayout={storedLayout}
      setLandmark={setLandmark}
      remove={remove}
      onEditPlace={setEditPlace}
      onOpenPlace={onOpenPlace}
    />
  ) : (
    <Stack gap="sm">
      <ColorByControl
        value={colorBy}
        onChange={(v) => {
          setColorBy(v);
          localStorage.setItem(COLOR_BY_KEY, v);
        }}
      />
      <Legend colorBy={colorBy} scheme={scheme} scene={scene.items} />
      {focusedItem && (
        <FocusCard
          item={focusedItem}
          bayId={focus?.bayId ?? null}
          data={data}
          onOpen={onOpenPlace}
          onClose={() => setFocus(null)}
        />
      )}
    </Stack>
  );

  return (
    <Stack gap="sm">
      {pointAt && (
        <Paper p="xs" radius="md" withBorder>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <IconMapPin size={18} color="var(--mantine-color-yellow-5)" />
              <Text size="sm" truncate>
                {pointAt.bin && (
                  <b>{boxTitle(pointAt.bin, numbersInternal)} </b>
                )}
                {pointedPlace
                  ? `${pointAt.bin ? "· " : ""}${locationLabel(data.byId, pointedPlace)}${pointAt.bin?.slot ? ` · slot ${pointAt.bin.slot}` : ""}`
                  : `· ${pointAt.bin ? describeBinLocation(pointAt.bin, data.byId) || "has no location" : ""}`}
                {pointedPlace && !highlight ? " — not on this map yet" : ""}
              </Text>
            </Group>
            <Group gap={4} wrap="nowrap">
              {target?.item && (
                <Button
                  size="compact-sm"
                  variant="light"
                  onClick={() =>
                    onOpenPlace((target.item as LocationState).id, pointAt)
                  }
                >
                  Open the shelves
                </Button>
              )}
              <CloseButton
                aria-label="Stop pointing at it"
                onClick={onClearFind}
              />
            </Group>
          </Group>
        </Paper>
      )}

      {empty && !editing && (
        <Text size="sm" c="dimmed">
          {unlocked
            ? "Nothing is drawn on this plan yet. The pencil on the map starts arranging it."
            : "Nothing is drawn on this plan yet — an admin arranges it."}
        </Text>
      )}

      {phone ? (
        <>
          {map}
          {side}
        </>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 300px",
            gap: "var(--mantine-spacing-md)",
            alignItems: "start",
          }}
        >
          {map}
          {side}
        </div>
      )}

      <PlaceEditSheet
        place={editPlace}
        opened={editPlace !== null}
        onClose={() => setEditPlace(null)}
      />
    </Stack>
  );
}

function ColorByControl({
  value,
  onChange,
}: {
  value: ColorBy;
  onChange: (v: ColorBy) => void;
}) {
  return (
    <SegmentedControl
      size="xs"
      fullWidth
      value={value}
      onChange={(v) => onChange(v as ColorBy)}
      data={[
        { value: "fullness", label: "How full" },
        { value: "category", label: "Category" },
        { value: "none", label: "Plain" },
      ]}
    />
  );
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: 3,
        background: color,
        border: `1.5px ${dashed ? "dashed" : "solid"} var(--mantine-color-dimmed)`,
        flexShrink: 0,
      }}
    />
  );
}

function Legend({
  colorBy,
  scheme,
  scene,
}: {
  colorBy: ColorBy;
  scheme: "dark" | "light";
  scene: SceneItem[];
}) {
  if (colorBy === "none") return null;
  if (colorBy === "fullness") {
    const ramp = FULLNESS_RAMP[scheme];
    const anyOver = scene.some((i) => i.segments.some((s) => s.stats.over));
    const anyUncounted = scene.some((i) =>
      i.segments.some((s) => fullnessClass(s.stats) === null),
    );
    return (
      <Stack gap={4}>
        <Group gap={6}>
          <Swatch color="transparent" />
          <Text size="xs">Empty</Text>
        </Group>
        {FULLNESS_LEGEND.map((label, i) => (
          <Group gap={6} key={label}>
            <Swatch color={ramp[i] as string} />
            <Text size="xs">{label}</Text>
          </Group>
        ))}
        {anyOver && (
          <Group gap={6}>
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                border: `2.5px solid ${OVER_COLOR}`,
              }}
            />
            <Text size="xs">More boxes than slots ( ! )</Text>
          </Group>
        )}
        {anyUncounted && (
          <Text size="xs" c="dimmed">
            Grey: no numbered slots, so no “full” — the number is how many boxes
            are there.
          </Text>
        )}
      </Stack>
    );
  }
  // Category: only the categories actually on the map, most common first.
  const counts = new Map<
    string,
    { name: string; color: string | null; n: number }
  >();
  for (const item of scene)
    for (const seg of item.segments) {
      const l = seg.stats.topLabel;
      if (!l) continue;
      const e = counts.get(l.id) ?? { name: l.name, color: l.color, n: 0 };
      e.n++;
      counts.set(l.id, e);
    }
  const rows = [...counts.values()].sort((a, b) => b.n - a.n);
  if (!rows.length)
    return (
      <Text size="xs" c="dimmed">
        No categories on any box here yet.
      </Text>
    );
  return (
    <Stack gap={4}>
      {rows.map((r) => (
        <Group gap={6} key={r.name}>
          <Swatch
            color={r.color ? `var(--mantine-color-${r.color}-filled)` : "gray"}
          />
          <Text size="xs">{r.name}</Text>
        </Group>
      ))}
      <Text size="xs" c="dimmed">
        Each bay takes the colour most of its boxes share.
      </Text>
    </Stack>
  );
}

function FocusCard({
  item,
  bayId,
  data,
  onOpen,
  onClose,
}: {
  item: SceneItem;
  bayId: string | null;
  data: PlanData;
  onOpen: (placeId: string) => void;
  onClose: () => void;
}) {
  const bay = bayId ? data.byId.get(bayId) : undefined;
  const subject = bay ?? item.place;
  const s = data.stats(subject.id);
  const title =
    bay && bay.id !== item.place.id
      ? `${item.place.name} › ${bay.name}`
      : item.place.name;
  return (
    <Paper p="sm" radius="md" withBorder>
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Text fw={700} truncate>
          {title}
        </Text>
        <CloseButton size="sm" aria-label="Close" onClick={onClose} />
      </Group>
      <Text size="sm">
        {s.capacity != null
          ? `${s.used} of ${s.capacity} slots used · ${s.boxes} ${s.boxes === 1 ? "box" : "boxes"}`
          : `${s.boxes} ${s.boxes === 1 ? "box" : "boxes"}`}
      </Text>
      {s.over && (
        <Text size="sm" c="red">
          ! Some shelf here holds more boxes than it has slots.
        </Text>
      )}
      {s.topLabel && (
        <Group gap={4} mt={4}>
          <Text size="xs" c="dimmed">
            Mostly
          </Text>
          <Badge size="sm" variant="light" color={s.topLabel.color ?? "gray"}>
            {s.topLabel.name}
          </Badge>
        </Group>
      )}
      <Button
        mt="sm"
        size="xs"
        variant="light"
        fullWidth
        onClick={() => onOpen(item.place.id)}
      >
        {item.kind === "space" ? "Open its map" : "Open the shelves"}
      </Button>
    </Paper>
  );
}

function EditorPanel({
  space,
  data,
  plan,
  hasPlan,
  unplaced,
  unit,
  setUnit,
  outlineEditing,
  setOutlineEditing,
  selection,
  selectedItem,
  selectedLandmark,
  onPlace,
  onAddLandmark,
  onStartOutline,
  writeLayout,
  writePlan,
  apply,
  storedLayout,
  setLandmark,
  remove,
  onEditPlace,
  onOpenPlace,
}: {
  space: LocationState;
  data: PlanData;
  plan: PlacePlan;
  hasPlan: boolean;
  unplaced: LocationState[];
  unit: LengthUnit;
  setUnit: (u: LengthUnit) => void;
  outlineEditing: boolean;
  setOutlineEditing: (v: boolean) => void;
  selection: Selection | null;
  selectedItem: SceneItem | undefined;
  selectedLandmark: Landmark | undefined;
  onPlace: (p: LocationState) => void;
  onAddLandmark: (k: LandmarkKind) => void;
  onStartOutline: () => void;
  writeLayout: (id: string, l: PlaceLayout | null) => Promise<void>;
  writePlan: (p: PlacePlan | null) => Promise<void>;
  apply: (changes: Change[], record: "undo" | "redo" | null) => Promise<void>;
  storedLayout: (id: string) => PlaceLayout | null;
  setLandmark: (next: Landmark | null, id: string) => PlacePlan;
  remove: (sel: Selection) => void;
  onEditPlace: (p: LocationState) => void;
  onOpenPlace: (id: string) => void;
}) {
  const scaled = plan.scaled;
  const lengthProps = { scaled, unit };

  return (
    <Stack gap="sm">
      {selectedItem && (
        <ItemInspector
          item={selectedItem}
          data={data}
          lengthProps={lengthProps}
          writeLayout={writeLayout}
          apply={apply}
          storedLayout={storedLayout}
          onRemove={() => selection && remove(selection)}
          onEditPlace={onEditPlace}
          onOpenPlace={onOpenPlace}
        />
      )}
      {selectedLandmark && (
        <LandmarkInspector
          landmark={selectedLandmark}
          lengthProps={lengthProps}
          onChange={(next) =>
            void writePlan(setLandmark(next, selectedLandmark.id))
          }
          onRemove={() => selection && remove(selection)}
        />
      )}
      {selection?.t === "vtx" && plan.outline[selection.index] && (
        <Paper p="sm" radius="md" withBorder>
          <Text fw={700} size="sm" mb={4}>
            Corner {selection.index + 1} of {plan.outline.length}
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Drag it; it squares up with its neighbours when close. Hold Alt to
            place it freely.
          </Text>
          <Button
            size="xs"
            variant="subtle"
            color="red"
            disabled={plan.outline.length <= 3}
            onClick={() => remove(selection)}
          >
            Remove this corner
          </Button>
        </Paper>
      )}

      <Paper p="sm" radius="md" withBorder>
        <Text fw={700} size="sm" mb={6}>
          {childrenIn(data.index, space.id).length === 0
            ? "Nothing to place yet"
            : unplaced.length
              ? "Not on the plan yet"
              : "Everything here is on the plan"}
        </Text>
        {unplaced.length > 0 && (
          <>
            <Group gap={6}>
              {unplaced.map((p) => (
                <Button
                  key={p.id}
                  size="compact-sm"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => onPlace(p)}
                >
                  {p.name}
                </Button>
              ))}
            </Group>
            <Text size="xs" c="dimmed" mt={6}>
              Tap one to drop it in the middle of the view, then drag it into
              place.
            </Text>
          </>
        )}
        {childrenIn(data.index, space.id).length === 0 && (
          <Text size="xs" c="dimmed">
            Nothing is inside {space.name} yet. Put walls or bays in it with the
            place editor's “Inside” field.
          </Text>
        )}
      </Paper>

      <Paper p="sm" radius="md" withBorder>
        <Text fw={700} size="sm" mb={6}>
          The room
        </Text>
        <Stack gap="xs">
          {plan.outline.length >= 3 ? (
            <Switch
              size="sm"
              checked={outlineEditing}
              onChange={(e) => setOutlineEditing(e.currentTarget.checked)}
              label="Move the room's corners"
              description="Drag a corner; drag the dot mid-wall to add one."
            />
          ) : (
            <Button size="xs" variant="light" onClick={onStartOutline}>
              Draw the room's walls
            </Button>
          )}
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconPlus size={14} />}
              >
                Add a landmark
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {LANDMARK_KINDS.map((k) => (
                <Menu.Item key={k} onClick={() => onAddLandmark(k)}>
                  {LANDMARK_NAMES[k]}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <Switch
            size="sm"
            checked={scaled}
            onChange={(e) =>
              void writePlan({ ...plan, scaled: e.currentTarget.checked })
            }
            label="Drawn to scale"
            description={
              scaled
                ? "Lengths are real measurements."
                : "Roughed in on a grid — no measurements shown."
            }
          />
          {scaled && (
            <SegmentedControl
              size="xs"
              value={unit}
              onChange={(v) => setUnit(v as LengthUnit)}
              data={[
                { value: "ft", label: "Feet & inches" },
                { value: "m", label: "Metres" },
              ]}
            />
          )}
          {hasPlan && plan.outline.length >= 3 && (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => {
                setOutlineEditing(false);
                void writePlan({ ...plan, outline: [] });
              }}
            >
              Remove the room's walls
            </Button>
          )}
        </Stack>
      </Paper>
      <Text size="xs" c="dimmed">
        Keys: arrows nudge (Shift for more), R turns, Delete takes off the plan,
        Ctrl+Z undoes. Hold Alt while dragging to skip snapping.
      </Text>
    </Stack>
  );
}

const LANDMARK_NAMES: Record<LandmarkKind, string> = {
  door: "Door",
  pillar: "Pillar or post",
  fixture: "Fixture — bench, desk, fridge…",
  text: "Text label",
};

type LengthProps = { scaled: boolean; unit: LengthUnit };

function FootprintFields({
  f,
  lengthProps,
  onChange,
  noDepth,
}: {
  f: { x: number; y: number; rotation: number; width: number; depth: number };
  lengthProps: LengthProps;
  onChange: (next: {
    x: number;
    y: number;
    rotation: number;
    width: number;
    depth: number;
  }) => void;
  noDepth?: boolean;
}) {
  return (
    <Stack gap={6}>
      <Group grow gap={6}>
        <LengthField
          label="Length"
          value={f.width}
          min={MIN_LENGTH_MM}
          onCommit={(width) => onChange({ ...f, width })}
          {...lengthProps}
        />
        {!noDepth && (
          <LengthField
            label="Depth"
            value={f.depth}
            min={MIN_LENGTH_MM}
            onCommit={(depth) => onChange({ ...f, depth })}
            {...lengthProps}
          />
        )}
      </Group>
      {lengthProps.scaled && (
        <Group grow gap={6}>
          <LengthField
            label="Across"
            value={f.x}
            onCommit={(x) => onChange({ ...f, x })}
            {...lengthProps}
          />
          <LengthField
            label="Down"
            value={f.y}
            onCommit={(y) => onChange({ ...f, y })}
            {...lengthProps}
          />
        </Group>
      )}
      <Group gap={6} align="flex-end" wrap="nowrap">
        <NumberInput
          size="xs"
          label="Facing (°)"
          value={Math.round(f.rotation * 10) / 10}
          min={0}
          max={359.9}
          decimalScale={1}
          onBlur={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v) && v !== f.rotation)
              onChange({ ...f, rotation: normalizeAngle(v) });
          }}
          style={{ flex: 1 }}
        />
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Turn a quarter anticlockwise"
          onClick={() =>
            onChange({ ...f, rotation: normalizeAngle(f.rotation - 90) })
          }
        >
          <IconRotate2 size={16} />
        </ActionIcon>
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Turn a quarter clockwise"
          onClick={() =>
            onChange({ ...f, rotation: normalizeAngle(f.rotation + 90) })
          }
        >
          <IconRotateClockwise2 size={16} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}

function ItemInspector({
  item,
  data,
  lengthProps,
  writeLayout,
  apply,
  storedLayout,
  onRemove,
  onEditPlace,
  onOpenPlace,
}: {
  item: SceneItem;
  data: PlanData;
  lengthProps: LengthProps;
  writeLayout: (id: string, l: PlaceLayout | null) => Promise<void>;
  apply: (changes: Change[], record: "undo" | "redo" | null) => Promise<void>;
  storedLayout: (id: string) => PlaceLayout | null;
  onRemove: () => void;
  onEditPlace: (p: LocationState) => void;
  onOpenPlace: (id: string) => void;
}) {
  const { place, layout, kind } = item;
  const kindName = { wall: "Wall", bay: "Bay", zone: "Area", space: "Room" }[
    kind
  ];

  /**
   * Set one bay's width along its wall, and grow or shrink the wall to
   * match, so the number typed is the number drawn. One undo step.
   */
  function setBayWidth(bayId: string, width: number) {
    const segs = item.segments;
    const total = segs.reduce(
      (sum, s) => sum + (s.bay?.id === bayId ? width : s.to - s.from),
      0,
    );
    const changes: Change[] = segs
      .filter((s) => s.bay)
      .map((s) => {
        const id = (s.bay as LocationState).id;
        return {
          kind: "layout" as const,
          id,
          before: storedLayout(id),
          after: {
            parentId: place.id,
            x: 0,
            y: 0,
            rotation: 0,
            width: id === bayId ? width : s.to - s.from,
            depth: layout.depth,
          },
        };
      });
    changes.push({
      kind: "layout",
      id: place.id,
      before: storedLayout(place.id),
      after: { ...layout, width: total },
    });
    void apply(changes, "undo");
  }

  function resetBayWidths() {
    void apply(
      item.segments
        .filter((s) => s.bay)
        .map((s) => {
          const id = (s.bay as LocationState).id;
          return {
            kind: "layout" as const,
            id,
            before: storedLayout(id),
            after: null,
          };
        }),
      "undo",
    );
  }
  const anyExplicit = item.segments.some(
    (s) => s.bay?.layout && s.bay.layout.parentId === place.id,
  );

  return (
    <Paper p="sm" radius="md" withBorder>
      <Group justify="space-between" wrap="nowrap" mb={6}>
        <Text fw={700} truncate>
          {place.name}
        </Text>
        <Badge size="sm" variant="light" color="gray">
          {kindName}
        </Badge>
      </Group>
      <FootprintFields
        f={layout}
        lengthProps={lengthProps}
        onChange={(f) => void writeLayout(place.id, { ...layout, ...f })}
      />
      {kind === "wall" && item.segments.length > 1 && (
        <Stack gap={4} mt="sm">
          <Group justify="space-between">
            <Text size="xs" fw={600}>
              Bays, left to right from the front
            </Text>
            {anyExplicit && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={resetBayWidths}
              >
                Even out
              </Button>
            )}
          </Group>
          {item.segments.map((s) =>
            s.bay ? (
              <LengthField
                key={s.bay.id}
                label={s.bay.name}
                value={s.to - s.from}
                min={MIN_LENGTH_MM}
                onCommit={(w) => setBayWidth((s.bay as LocationState).id, w)}
                {...lengthProps}
              />
            ) : null,
          )}
        </Stack>
      )}
      <Group gap={6} mt="sm">
        <Button size="xs" variant="light" onClick={() => onOpenPlace(place.id)}>
          {kind === "space" ? "Open its map" : "Open the shelves"}
        </Button>
        <Button
          size="xs"
          variant="default"
          onClick={() => onEditPlace(data.byId.get(place.id) ?? place)}
        >
          Edit place…
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconX size={14} />}
          onClick={onRemove}
        >
          Off the plan
        </Button>
      </Group>
    </Paper>
  );
}

function LandmarkInspector({
  landmark,
  lengthProps,
  onChange,
  onRemove,
}: {
  landmark: Landmark;
  lengthProps: LengthProps;
  onChange: (next: Landmark) => void;
  onRemove: () => void;
}) {
  const kind = landmarkKind(landmark.kind);
  const [label, setLabel] = useState(landmark.label ?? "");
  useEffect(() => setLabel(landmark.label ?? ""), [landmark.label]);
  return (
    <Paper p="sm" radius="md" withBorder>
      <Stack gap={6}>
        <Select
          size="xs"
          label="What it is"
          value={kind}
          allowDeselect={false}
          data={LANDMARK_KINDS.map((k) => ({
            value: k,
            label: LANDMARK_NAMES[k],
          }))}
          onChange={(v) => v && onChange({ ...landmark, kind: v })}
        />
        <TextInput
          size="xs"
          label="Label"
          placeholder={kind === "door" ? "e.g. Loading door" : "optional"}
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          onBlur={() => {
            const next = label.trim() || null;
            if (next !== landmark.label) onChange({ ...landmark, label: next });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <FootprintFields
          f={landmark}
          lengthProps={lengthProps}
          noDepth={kind === "door"}
          onChange={(f) => onChange({ ...landmark, ...f })}
        />
        <Button size="xs" variant="subtle" color="red" onClick={onRemove}>
          Delete this landmark
        </Button>
      </Stack>
    </Paper>
  );
}
