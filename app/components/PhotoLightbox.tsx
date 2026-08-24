/**
 * Full-size photo viewer, shared by every surface with a photo strip (bin
 * page, scanner peek).
 *
 * It pages through the WHOLE strip in place — swipe or flick on a touch
 * screen, arrow keys or the edge buttons anywhere else — and pinch or
 * double-tap to zoom into a photo. Reported from the field: the strip is a
 * contact sheet of one box, so comparing two shots is the normal thing to
 * want, and reading a label in one of them is the next thing.
 *
 * The gesture arbitration (pan vs. page, flick projection, pinch anchoring)
 * lives in `~/lib/photoGestures` and is ported from PhotoSwipe's handlers —
 * see the credit and the explanation of each borrowed technique there.
 *
 * Delete stays one-tap with no confirm: opening the lightbox is already a
 * deliberate look at exactly this photo, and the undo toast catches the rest.
 * It advances to the next photo instead of dumping you back to the page, so
 * clearing out several bad shots is one pass.
 *
 * Fills the screen on a phone; a normal centered dialog on desktop, where
 * full-screen would be a 4K modal around a modest image.
 */
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { EntryState } from "@shared/reducer";
import {
  IconChevronLeft,
  IconChevronRight,
  IconTrash,
} from "@tabler/icons-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuthors } from "~/lib/authors";
import { relativeTime } from "~/lib/format";
import { usePhotoGestures } from "~/lib/photoGestures";
import { PHONE_MEDIA, TOUCH_TARGET } from "~/lib/ui";
import { deleteEntryWithUndo } from "~/lib/undo";
import { usePhotoUrl } from "./PhotoImg";

/** Slide height. Fixed so the image doesn't jump around between photos. */
const SLIDE_HEIGHT = "70dvh";
/** Must match SNAP_MS in ~/lib/photoGestures so React and the engine agree. */
const SNAP = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";

export function PhotoLightbox({
  photos,
  entry,
  onClose,
}: {
  /**
   * The whole strip this viewer pages through, in the order it's displayed.
   * Live: it shrinks under us when anyone deletes a photo.
   */
  photos: EntryState[];
  /** The photo that was tapped. null closes the viewer. */
  entry: EntryState | null;
  onClose: () => void;
}) {
  const authors = useAuthors();
  const phone = useMediaQuery(PHONE_MEDIA, true, {
    getInitialValueInEffect: false,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const openedId = entry?.id ?? null;
  // Every open starts on the photo that was tapped. This CLEARS rather than
  // assigns on purpose: "which photo" stays a pure fallback to openedId, so
  // the first render after opening can't briefly disagree with the effect and
  // land somewhere else. It also means re-tapping the same thumb starts there
  // again instead of resuming wherever the last visit swiped to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: openedId is the trigger, not a value read here.
  useEffect(() => setActiveId(null), [openedId]);

  const currentId = activeId ?? openedId;
  const index = photos.findIndex((p) => p.id === currentId);
  const current = index >= 0 ? photos[index] : entry;
  const safeIndex = Math.max(index, 0);

  // Where to land if the photo on screen disappears (another device deleted
  // it, or our own delete raced the live query): hold the position in the
  // strip rather than the identity of a thing that's gone.
  const lastIndex = useRef(0);
  useEffect(() => {
    if (index >= 0) lastIndex.current = index;
  }, [index]);
  useEffect(() => {
    if (entry === null || index >= 0) return;
    const fallback = photos[Math.min(lastIndex.current, photos.length - 1)];
    if (fallback) setActiveId(fallback.id);
    // Nothing left to look at.
    else onClose();
  }, [entry, index, photos, onClose]);

  const go = useCallback(
    (delta: number): boolean => {
      if (index < 0) return false;
      const next = photos[index + delta];
      if (!next) return false;
      setActiveId(next.id);
      return true;
    },
    [index, photos],
  );

  // State, not a ref, and the difference is load-bearing: Mantine's Portal
  // renders null on its first pass, so a ref here is still null when the
  // gesture effect first runs — and a ref filling in later can't re-trigger an
  // effect. Every gesture was dead for exactly that reason while the pager
  // buttons kept working. See the note on PhotoGestureOptions.viewport.
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const activeImgRef = useRef<HTMLImageElement>(null);

  const { reset } = usePhotoGestures({
    viewport,
    trackRef,
    imgRef: activeImgRef,
    index: safeIndex,
    count: photos.length,
    onPage: go,
    enabled: entry !== null && photos.length > 0,
  });
  // Arrow keys, the pager buttons and delete all change the photo without
  // going through a gesture — the engine's zoom/pan has to come back to rest
  // with them, not just when a swipe ends.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentId is the trigger, not a value read here.
  useEffect(() => reset(), [currentId, reset]);

  const multi = photos.length > 1;

  useEffect(() => {
    if (entry === null || !multi) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, multi, go]);

  const deleteCurrent = () => {
    if (!current || index < 0) return;
    const next = photos[index + 1] ?? photos[index - 1] ?? null;
    deleteEntryWithUndo(
      current.binId,
      current.id,
      current.kind === "contents_photo" ? "Contents photo" : "Item photo",
    );
    if (next) setActiveId(next.id);
    else onClose();
  };

  const arrowSize = phone ? TOUCH_TARGET : 36;

  return (
    <Modal
      opened={entry !== null}
      onClose={onClose}
      fullScreen={phone}
      size="xl"
      centered
      padding="xs"
      title={
        current && (
          <Group gap={8}>
            <Text size="sm" c="dimmed">
              {current.kind === "contents_photo" ? "Contents" : "Item"} ·{" "}
              {(current.deviceId && authors[current.deviceId]) ?? ""}{" "}
              {relativeTime(current.effectiveTime)}
            </Text>
            {multi && index >= 0 && (
              <Text size="sm" c="dimmed" fw={600}>
                {index + 1}/{photos.length}
              </Text>
            )}
          </Group>
        )
      }
    >
      {entry !== null && photos.length > 0 && (
        <Stack gap="xs">
          <Box
            ref={setViewport}
            style={{
              position: "relative",
              overflow: "hidden",
              // Every axis is ours: horizontal pages, vertical and pinch pan
              // and zoom the photo. Leaving any of it to the browser means
              // the two fight over the same fingers.
              touchAction: "none",
              userSelect: "none",
            }}
          >
            <div
              ref={trackRef}
              style={{
                display: "flex",
                willChange: "transform",
                transform: `translate3d(calc(${-safeIndex * 100}%), 0, 0)`,
                transition: SNAP,
              }}
            >
              {photos.map((photo, i) => (
                <Slide
                  key={photo.id}
                  entry={photo}
                  // Only the photo on screen and its immediate neighbours are
                  // fetched — a box with 30 shots must not pull 30 full-size
                  // renditions because someone opened one. Neighbours ARE
                  // fetched, so the next swipe is instant instead of a flash
                  // of "loading…".
                  load={Math.abs(i - safeIndex) <= 1}
                  imgRef={i === safeIndex ? activeImgRef : undefined}
                />
              ))}
            </div>
            {multi && (
              <>
                <PagerButton
                  side="left"
                  size={arrowSize}
                  disabled={index <= 0}
                  onClick={() => go(-1)}
                />
                <PagerButton
                  side="right"
                  size={arrowSize}
                  disabled={index >= photos.length - 1}
                  onClick={() => go(1)}
                />
              </>
            )}
          </Box>
          <Button
            color="red"
            variant="light"
            leftSection={<IconTrash size={16} />}
            onClick={deleteCurrent}
          >
            Delete photo
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

function Slide({
  entry,
  load,
  imgRef,
}: {
  entry: EntryState;
  load: boolean;
  imgRef?: RefObject<HTMLImageElement | null>;
}) {
  const url = usePhotoUrl(load ? entry.photoHash : null, null, true);
  return (
    <Box
      style={{
        flex: "0 0 100%",
        height: SLIDE_HEIGHT,
        display: "grid",
        placeItems: "center",
      }}
    >
      {url ? (
        <img
          ref={imgRef}
          src={url}
          alt={entry.kind === "contents_photo" ? "Box contents" : "An item"}
          draggable={false}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 12,
            display: "block",
            willChange: "transform",
            // The gesture engine writes these directly. Declaring them here
            // means a re-render (paging away, the strip changing) puts a
            // photo we're no longer looking at back to rest.
            transform: "none",
            transition: SNAP,
          }}
        />
      ) : (
        <Text c="dimmed">{load ? "loading…" : ""}</Text>
      )}
    </Box>
  );
}

function PagerButton({
  side,
  size,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  size: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <ActionIcon
      variant="default"
      radius="xl"
      w={size}
      h={size}
      disabled={disabled}
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [side]: 4,
        opacity: disabled ? 0.25 : 0.85,
      }}
    >
      {side === "left" ? <IconChevronLeft /> : <IconChevronRight />}
    </ActionIcon>
  );
}
