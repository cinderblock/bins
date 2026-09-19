/**
 * The right-hand pane of the desk-mode browse layout: everything about the
 * selected box, without leaving the list.
 *
 * The job this serves is checking, not capturing — working down a shelf
 * asking "is this labelled right, is this categorised, what's actually in
 * it". Navigating into a box page and back for each one loses your place in
 * the list and your scroll position; keeping the list alive next to a big
 * photo is the whole point.
 *
 * Nearly read-only. Editing lives on the full box page, one click away, so
 * there is no second copy of the edit logic to drift. The one exception is
 * DELETING a photo or note: spotting the wrong one is exactly what this pane
 * is for, and routing through the box page lost your place in the list. The
 * delete control is shared (DeleteEntryButton) and two-tap, so nothing here
 * drifts or dies to a stray click — and the Delete key arms/fires the hero's
 * delete the same way, pairing with the arrow keys that walk the list. The
 * collapsed Deleted section mirrors the bin page's, so a delete made here can
 * also be taken back here.
 */
import {
  Anchor,
  Badge,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { EntryState } from "@shared/reducer";
import { hasContent } from "@shared/reducer";
import { IconMapPin } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { DeleteEntryButton } from "~/components/DeleteEntryButton";
import { DeletedEntries } from "~/components/DeletedEntries";
import { PhotoImg } from "~/components/PhotoImg";
import { useAuthors } from "~/lib/authors";
import {
  boxNumber,
  boxPath,
  boxTitle,
  useBoxNumbersInternal,
} from "~/lib/boxRef";
import { useBoxSizes } from "~/lib/boxSizes";
import { db } from "~/lib/db";
import { relativeTime } from "~/lib/format";
import { formatWeight } from "~/lib/labels";
import { deleteEntryWithUndo } from "~/lib/undo";

export function BinDetailPane({ binId }: { binId: number | null }) {
  const bin = useLiveQuery(
    async () => (binId == null ? null : ((await db.bins.get(binId)) ?? null)),
    [binId],
    null,
  );
  // Live AND deleted — the tombstones feed the Deleted section below.
  // hasContent skips remove/restore stubs awaiting their entry.add.
  const allEntries = useLiveQuery(
    async () =>
      binId == null
        ? []
        : (await db.entries.where("binId").equals(binId).toArray())
            .filter(hasContent)
            .sort((a, b) => b.effectiveTime - a.effectiveTime),
    [binId],
    [],
  );
  const labels = useLiveQuery(async () => db.labels.toArray(), [], []);
  const sizes = useBoxSizes();
  const numbersInternal = useBoxNumbersInternal();
  const authors = useAuthors();
  /**
   * Which photo fills the hero slot. Stored WITH its box so moving to another
   * box falls back to that box's newest photo automatically — derived rather
   * than reset in an effect, so there is no stale frame in between.
   */
  const [active, setActive] = useState<{ binId: number; id: string } | null>(
    null,
  );
  const activeId = active?.binId === binId ? active.id : null;

  /**
   * Delete key = the keyboard twin of the hero's two-tap delete button: first
   * press arms it (the button shows "Delete?"), second press fires. Armed
   * state is keyed by ENTRY id, so switching boxes or photos disarms rather
   * than carrying a primed delete onto something else. A ref feeds the
   * handler the current hero (same pattern as the list's arrow keys); the
   * hook sits above the early return so the hook count stays stable.
   */
  const heroRef = useRef<EntryState | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || e.repeat) return;
      // In a text field Delete edits text — except the search box, which
      // keeps focus while arrows walk the list, so an EMPTY input still
      // counts as "delete the photo" intent. (target can be document/window
      // for synthetic dispatches, hence the instanceof.)
      const editable =
        e.target instanceof Element
          ? e.target.closest("input, textarea, [contenteditable]")
          : null;
      if (
        editable &&
        !(editable instanceof HTMLInputElement && editable.value === "")
      )
        return;
      const hero = heroRef.current;
      if (!hero) return;
      e.preventDefault();
      if (armedId === hero.id) {
        setArmedId(null);
        deleteEntryWithUndo(
          hero.binId,
          hero.id,
          hero.kind === "contents_photo" ? "Contents photo" : "Item photo",
        );
      } else {
        setArmedId(hero.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armedId]);

  if (binId == null || !bin) {
    heroRef.current = null;
    return (
      <Paper p="xl" radius="lg" withBorder h="100%">
        <Text c="dimmed" ta="center">
          Pick a box to see its photos and notes. ↑ and ↓ move through the list.
        </Text>
      </Paper>
    );
  }

  // A defined size wins; legacy free text is the fallback for boxes not yet
  // migrated or set.
  const sizeLabel =
    sizes.find((s) => s.id === bin.sizeId)?.name ?? bin.sizeClass ?? null;

  const entries = allEntries.filter((e) => !e.deletedByOpId);
  const deleted = allEntries.filter((e) => e.deletedByOpId);
  const photos = entries.filter((e) => e.photoHash);
  const hero = photos.find((e) => e.id === activeId) ?? photos[0] ?? null;
  heroRef.current = hero;
  const notes = entries.filter((e) => e.text);
  const binLabels = labels.filter((l) => bin.labelIds?.includes(l.id));

  return (
    <Paper p="md" radius="lg" withBorder h="100%">
      <Stack gap="sm" h="100%">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Title order={3} lineClamp={2}>
              {boxTitle(bin, numbersInternal)}
            </Title>
            <Text size="sm" c="dimmed">
              {[
                boxNumber(bin, numbersInternal),
                sizeLabel,
                bin.weightGrams ? formatWeight(bin.weightGrams) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </div>
          <Anchor component={Link} to={boxPath(bin, numbersInternal)} size="sm">
            Open
          </Anchor>
        </Group>

        {bin.locationName && (
          <Group gap={4} c="dimmed">
            <IconMapPin size={16} />
            <Text size="sm">{bin.locationName}</Text>
          </Group>
        )}

        {binLabels.length > 0 && (
          <Group gap={6}>
            {binLabels.map((l) => (
              <Badge key={l.id} color={l.color ?? "gray"} variant="light">
                {l.name}
              </Badge>
            ))}
          </Group>
        )}

        {photos.length === 0 && notes.length === 0 && (
          <Text c="dimmed" size="sm">
            Nothing captured for this box yet.
          </Text>
        )}

        {/* The hero FITS the pane — it never exceeds the space available, so
            verifying a box is a glance and not a scroll. Stacking photos at
            full width was worse than useless: one photo could be taller than
            the screen, and you had to scroll past it to learn anything. */}
        {hero && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PhotoImg
              key={hero.id}
              hash={hero.photoHash as string}
              // preferFull, or PhotoImg serves the 320px thumb — which looked
              // like mud once it filled the pane.
              preferFull
              alt=""
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: 8,
                display: "block",
              }}
            />
          </div>
        )}

        {/* Caption for the hero: what it is, who took it, when — and the
            delete for exactly the photo on screen. */}
        {hero && (
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="xs" c="dimmed" truncate>
              {hero.kind === "contents_photo" ? "Contents" : "Item"} ·{" "}
              {(hero.deviceId && authors[hero.deviceId]) ?? ""}{" "}
              {relativeTime(hero.effectiveTime)}
            </Text>
            <DeleteEntryButton
              binId={bin.id}
              entryId={hero.id}
              what={
                hero.kind === "contents_photo" ? "Contents photo" : "Item photo"
              }
              armed={armedId === hero.id}
              onArmedChange={(a) => setArmedId(a ? hero.id : null)}
            />
          </Group>
        )}

        {/* Other photos stay one click away instead of one scroll away. */}
        {photos.length > 1 && (
          <Group gap="xs" wrap="nowrap" style={{ overflowX: "auto" }}>
            {photos.map((e) => (
              <UnstyledButton
                key={e.id}
                onClick={() => setActive({ binId, id: e.id })}
                aria-label="Show this photo"
                style={{ flexShrink: 0, lineHeight: 0 }}
              >
                <PhotoImg
                  hash={e.photoHash as string}
                  thumbHash={e.thumbHash}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: "cover",
                    borderRadius: 6,
                    display: "block",
                    outline:
                      e.id === hero?.id
                        ? "2px solid var(--mantine-color-blue-5)"
                        : "none",
                    opacity: e.id === hero?.id ? 1 : 0.65,
                  }}
                />
              </UnstyledButton>
            ))}
          </Group>
        )}

        {notes.length > 0 && (
          // Bounded so notes can never push the photo off-screen; scrolls
          // internally when there are a lot of them.
          <ScrollArea style={{ maxHeight: "22vh" }} type="auto">
            <Stack gap="xs">
              {notes.map((e) => (
                <Paper key={e.id} p="xs" radius="md" withBorder>
                  <Text size="sm">{e.text}</Text>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      {(e.deviceId && authors[e.deviceId]) ?? ""}{" "}
                      {relativeTime(e.effectiveTime)}
                    </Text>
                    <DeleteEntryButton
                      binId={bin.id}
                      entryId={e.id}
                      what="Note"
                    />
                  </Group>
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
        )}

        {/* Recovery, same as the bin page — a delete made HERE shouldn't need
            a navigation to take back once its undo toast is gone. */}
        <DeletedEntries entries={deleted} authors={authors} />
      </Stack>
    </Paper>
  );
}
