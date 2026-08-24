/**
 * Full-size photo viewer, shared by every surface with a photo strip (bin
 * page, scanner peek).
 *
 * It pages through the WHOLE strip in place — swipe on a touch screen, arrow
 * keys or the edge buttons anywhere else. Reported from the field: the strip
 * is a contact sheet of one box, so comparing two shots is the normal thing
 * to want, and it used to cost a close and a re-tap for every single photo.
 *
 * Delete stays one-tap with no confirm: opening the lightbox is already a
 * deliberate look at exactly this photo, and the undo toast catches the rest.
 * It now advances to the next photo instead of dumping you back to the page —
 * clearing out several bad shots is one pass, not one round trip each.
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
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthors } from "~/lib/authors";
import { relativeTime } from "~/lib/format";
import { PHONE_MEDIA, TOUCH_TARGET } from "~/lib/ui";
import { deleteEntryWithUndo } from "~/lib/undo";
import { usePhotoUrl } from "./PhotoImg";

/** Horizontal travel (px) past which letting go means "next photo". */
const SWIPE_THRESHOLD = 56;
/** A drag commits to horizontal or vertical once it moves this far (px). */
const DIRECTION_SLOP = 8;
/** Slide height. Fixed so the image doesn't jump around between photos. */
const SLIDE_HEIGHT = "70dvh";

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
    (delta: number) => {
      if (index < 0) return;
      const next = photos[index + delta];
      if (next) setActiveId(next.id);
    },
    [index, photos],
  );

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

  // Drag-to-page. Hand-rolled rather than pulling in a carousel: the whole
  // behavior is one axis, and this app stays installable-and-offline cheap.
  const [dragX, setDragX] = useState(0);
  const drag = useRef<{ x: number; y: number; horizontal: boolean | null }>(
    null,
  );

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t || !multi) return;
    drag.current = { x: t.clientX, y: t.clientY, horizontal: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    const t = e.touches[0];
    if (!d || !t) return;
    const dx = t.clientX - d.x;
    const dy = t.clientY - d.y;
    if (d.horizontal === null) {
      if (Math.abs(dx) < DIRECTION_SLOP && Math.abs(dy) < DIRECTION_SLOP)
        return;
      // A mostly-vertical drag belongs to the modal's own scrolling.
      d.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!d.horizontal) return;
    // Resist at the ends, so the strip reads as bounded rather than stuck.
    const atEnd =
      (dx > 0 && index <= 0) || (dx < 0 && index >= photos.length - 1);
    setDragX(atEnd ? dx / 4 : dx);
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.horizontal && Math.abs(dragX) > SWIPE_THRESHOLD)
      go(dragX < 0 ? 1 : -1);
    setDragX(0);
  };

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
            style={{ position: "relative", overflow: "hidden" }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={endDrag}
            onTouchCancel={endDrag}
          >
            <div
              style={{
                display: "flex",
                // Vertical panning still belongs to the page; we take over
                // the horizontal axis so a swipe doesn't also scroll.
                touchAction: "pan-y",
                transform: `translateX(calc(${-Math.max(index, 0) * 100}% + ${dragX}px))`,
                transition: drag.current ? "none" : "transform 200ms ease-out",
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
                  load={Math.abs(i - Math.max(index, 0)) <= 1}
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

function Slide({ entry, load }: { entry: EntryState; load: boolean }) {
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
          src={url}
          alt={entry.kind === "contents_photo" ? "Box contents" : "An item"}
          draggable={false}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 12,
            display: "block",
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
