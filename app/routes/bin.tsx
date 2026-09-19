/**
 * The bin page — one URL per physical box, opened by scanning its sticker.
 * One-handed layout: fixed bottom ActionBar (Contents / Item / Note /
 * Location), scrollable content above (header, primary photo, photo strip,
 * notes). Unclaimed bins render the claim panel in place; bins not in the
 * replica (foreign group or not yet synced) get a helpful dead-end.
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import type { EntryState } from "@shared/reducer";
import { hasContent } from "@shared/reducer";
import {
  IconArchive,
  IconArrowLeft,
  IconCamera,
  IconMapPin,
  IconNote,
  IconPackage,
  IconPencil,
  IconPrinter,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CaptureOverlay } from "~/components/CaptureOverlay";
import { ClaimBin } from "~/components/ClaimBin";
import { DeletedEntries } from "~/components/DeletedEntries";
import { EditBoxSheet } from "~/components/EditBoxSheet";
import { FillLevelBadge } from "~/components/FillLevel";
import { LabelSheet } from "~/components/LabelSheet";
import { LabelPrintSheet } from "~/components/LabelSheet.print";
import { LocationSheet } from "~/components/LocationSheet";
import { NoteSheet } from "~/components/NoteSheet";
import { PhotoImg } from "~/components/PhotoImg";
import { PhotoLightbox } from "~/components/PhotoLightbox";
import { useAdminPassword } from "~/lib/admin";
import { useAuthors } from "~/lib/authors";
import { HANDLE_RE, boxTitle, normalizeHandle } from "~/lib/boxRef";
import { db } from "~/lib/db";
import { useDeployment } from "~/lib/deployment";
import { relativeTime } from "~/lib/format";
import { formatWeight, labelColor } from "~/lib/labels";
import { usePendingSuggestions } from "~/lib/suggestions";
import { syncNow } from "~/lib/sync";
import { ACTION_BAR_HEIGHT, PAGE_MAXW } from "~/lib/ui";
import { deleteEntryWithUndo } from "~/lib/undo";

export default function BinPage() {
  const params = useParams();
  const navigate = useNavigate();
  // Two URL forms, one page: `/123` by number, `/b/<uuid>` by handle. Either
  // resolves to the same replica row; everything below keys on `bin.id`.
  const idParam = /^\d{1,9}$/.test(params.binId ?? "")
    ? Number(params.binId)
    : null;
  const handleParam = HANDLE_RE.test(params.handle ?? "")
    ? normalizeHandle(params.handle as string)
    : null;
  const validRef = idParam !== null || handleParam !== null;

  const bin = useLiveQuery(
    async () => {
      if (idParam !== null) return (await db.bins.get(idParam)) ?? null;
      if (handleParam !== null)
        return (
          (await db.bins.where("handle").equals(handleParam).first()) ?? null
        );
      return null;
    },
    [idParam, handleParam],
    undefined,
  );
  const binId = bin?.id ?? null;
  // Live AND deleted in one query — the deleted ones feed the recovery
  // section below. Contentless rows are remove/restore stubs whose entry.add
  // hasn't synced yet (see shared/reducer.ts); there's nothing to show for
  // either state until it does.
  const allEntries = useLiveQuery(
    async () =>
      binId !== null
        ? (await db.entries.where("binId").equals(binId).toArray())
            .filter(hasContent)
            .sort((a, b) => b.effectiveTime - a.effectiveTime)
        : [],
    [binId],
    [],
  );
  const authors = useAuthors();

  // The group's label rows, to render a bin's labelIds as named, colored chips.
  const labelById = useLiveQuery(
    async () => new Map((await db.labels.toArray()).map((l) => [l.id, l])),
    [],
    new Map(),
  );

  const [capture, setCapture] = useState<
    null | "contents_photo" | "item_photo"
  >(null);
  const deployment = useDeployment();
  const numbersInternal = deployment?.boxNumbers === "internal";
  const adminPassword = useAdminPassword();
  // Printing burns label stock and the endpoint is admin-gated like
  // allocation, so the button only appears once admin is unlocked.
  const canPrintLabel =
    deployment?.labelPrinting === true && typeof adminPassword === "string";
  const [labelOpen, setLabelOpen] = useState(false);

  const [noteOpen, setNoteOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // An unlocked admin edits identity fields directly; everyone else suggests.
  const canEditDirectly = typeof adminPassword === "string";
  const pendingSuggestions = usePendingSuggestions(binId ?? 0);
  void binId;
  const [lightbox, setLightbox] = useState<EntryState | null>(null);

  useDocumentTitle(
    !bin
      ? "bins"
      : numbersInternal
        ? `${boxTitle(bin, true)} · bins`
        : `#${bin.id}${bin.name ? ` ${bin.name}` : ""} · bins`,
  );

  if (!validRef) {
    return (
      <Center h="100dvh">
        <Text>Not a box link.</Text>
      </Center>
    );
  }

  if (bin === undefined) return null;

  if (bin === null) {
    return (
      <Center h="100dvh" p="md">
        <Stack align="center">
          <Title order={3}>This box isn't here</Title>
          <Text c="dimmed" ta="center" size="sm">
            It may not be synced yet, or it belongs to another group. Pull the
            latest and try again.
          </Text>
          <Button onClick={() => void syncNow()}>Sync now</Button>
          <Button variant="subtle" component={Link} to="/">
            Back to scanner
          </Button>
        </Stack>
      </Center>
    );
  }

  const entries = allEntries.filter((e) => !e.deletedByOpId);
  const deleted = allEntries.filter((e) => e.deletedByOpId);
  const photos = entries.filter((e) => e.photoHash);
  const notes = entries.filter((e) => e.kind === "note");

  return (
    <div style={{ minHeight: "100dvh", paddingBottom: ACTION_BAR_HEIGHT + 24 }}>
      {/* Top bar */}
      <Group
        justify="space-between"
        p="sm"
        pt="max(var(--mantine-spacing-sm), calc(env(safe-area-inset-top) + var(--bins-banner-h, 0px)))"
        maw={PAGE_MAXW}
        mx="auto"
      >
        <Group gap="sm">
          <ActionIcon
            variant="default"
            size="xl"
            radius="xl"
            // Return wherever the box was opened from (all-boxes, search) —
            // the scanner only when this page is the start of history.
            onClick={() =>
              (window.history.state?.idx ?? 0) > 0
                ? navigate(-1)
                : navigate("/")
            }
            aria-label="Back"
          >
            <IconArrowLeft />
          </ActionIcon>
          {/* Where numbers are internal the NAME leads and the number never
              appears — an unnamed box says so in words rather than falling
              back to "#193", which is exactly the thing not to show. Public-
              number deployments keep the number as the headline. */}
          <div>
            <Group gap={8}>
              <Title order={3}>
                {numbersInternal ? boxTitle(bin, true) : `#${bin.id}`}
              </Title>
              {bin.sizeClass && <Badge variant="light">{bin.sizeClass}</Badge>}
              {bin.weightGrams != null && (
                <Badge variant="light" color="gray">
                  {formatWeight(bin.weightGrams)}
                </Badge>
              )}
              <FillLevelBadge percent={bin.fillLevel} />
              {bin.status === "retired" && <Badge color="gray">retired</Badge>}
            </Group>
            {!numbersInternal && bin.name && <Text size="sm">{bin.name}</Text>}
            {bin.description && (
              <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-line" }}>
                {bin.description}
              </Text>
            )}
          </div>
          {/* Naming and sizing a box used to be reachable only from the
              all-boxes list, behind the admin password — so nobody found it.
              It lives next to the name it changes now; what the button DOES
              still depends on who you are (see EditBoxSheet). */}
          {bin.status !== "unclaimed" && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              radius="xl"
              onClick={() => setEditOpen(true)}
              aria-label={canEditDirectly ? "Edit box" : "Suggest a change"}
            >
              <IconPencil size={18} />
            </ActionIcon>
          )}
        </Group>
        <Group gap="xs">
          {/* Only where a printer is configured AND admin is unlocked (label
              printing consumes stock and the endpoint is admin-gated like
              allocation). Print AFTER naming the box — the title is the
              headline, so an unnamed box prints "Box 193". */}
          {canPrintLabel && bin.status !== "unclaimed" && (
            <Button
              size="xs"
              variant="light"
              radius="xl"
              leftSection={<IconPrinter size={16} />}
              onClick={() => setLabelOpen(true)}
            >
              Label
            </Button>
          )}
        </Group>
      </Group>

      {/* A retired box means the contents are gone and, where containers get
          reused, the physical box is back in the pile wearing a dead sticker.
          Say that outright: a small grey "retired" badge on an empty-looking
          page reads like lost data, and someone will file it as a bug or,
          worse, start putting things in a box the system thinks is empty.
          The record is kept on purpose — the id is never reissued, so this
          page is exactly how a stale sticker gets identified. */}
      {bin.status === "retired" && (
        <Box maw={PAGE_MAXW} mx="auto" px="md" pb="xs">
          <Alert color="orange" variant="light" icon={<IconArchive />}>
            <Text fw={600} size="sm">
              This box was emptied.
            </Text>
            <Text size="sm">
              Its contents were checked out and the record is kept for history.
              If this sticker is still on a physical box, peel it off — the box
              is available again, and a new one gets a new sticker.
            </Text>
          </Alert>
        </Box>
      )}

      {bin.status === "unclaimed" ? (
        <Box maw={PAGE_MAXW} mx="auto">
          <ClaimBin binId={bin.id} />
        </Box>
      ) : (
        <Stack gap="md" px="md" maw={PAGE_MAXW} mx="auto">
          {/* Say a proposal is in flight, so the next person doesn't file the
              same one — and so the person who sent it can see it landed. */}
          {pendingSuggestions.length > 0 && (
            <Alert
              variant="light"
              color="blue"
              p="xs"
              icon={<IconPencil size={18} />}
            >
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm">
                  {pendingSuggestions.length === 1
                    ? "A change to this box is waiting for an admin."
                    : `${pendingSuggestions.length} changes to this box are waiting for an admin.`}
                </Text>
                {canEditDirectly && (
                  <Button
                    size="compact-sm"
                    variant="light"
                    component={Link}
                    to="/admin"
                  >
                    Review
                  </Button>
                )}
              </Group>
            </Alert>
          )}

          {/* Location + labels line */}
          <Group gap="xs">
            <IconMapPin size={16} style={{ opacity: 0.6 }} />
            <Text size="sm" c={bin.locationName ? undefined : "dimmed"}>
              {bin.locationName ?? "no location set"}
            </Text>
            {bin.externalLabel && (
              <Badge
                variant="outline"
                color="gray"
                style={{ textTransform: "none" }}
              >
                {bin.externalLabel}
              </Badge>
            )}
          </Group>

          {/* Category labels — tap to add/remove or set weight */}
          <Group gap="xs">
            {bin.labelIds.map((id) => {
              const label = labelById.get(id);
              if (!label) return null;
              return (
                <Badge
                  key={id}
                  variant="light"
                  color={labelColor(label.color)}
                  style={{ textTransform: "none" }}
                >
                  {label.name}
                </Badge>
              );
            })}
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              leftSection={<IconTag size={14} />}
              onClick={() => setLabelsOpen(true)}
            >
              {bin.labelIds.length > 0 || bin.fillLevel != null
                ? "Edit"
                : "Categories & fill"}
            </Button>
          </Group>

          {/* Primary photo (latest top-down contents shot) — tap to open */}
          {bin.primaryPhotoHash ? (
            <UnstyledButton
              onClick={() => {
                const entry = photos.find(
                  (e) => e.photoHash === bin.primaryPhotoHash,
                );
                if (entry) setLightbox(entry);
              }}
              aria-label="Open contents photo"
            >
              <PhotoImg
                hash={bin.primaryPhotoHash}
                alt="Contents of this box"
                preferFull
                style={{
                  width: "100%",
                  borderRadius: 12,
                  maxHeight: "45dvh",
                  display: "block",
                }}
              />
            </UnstyledButton>
          ) : (
            <Paper p="xl" radius="lg" withBorder>
              <Text c="dimmed" ta="center">
                No contents photo yet — open the box and take a top-down shot.
              </Text>
            </Paper>
          )}

          {/* Photo strip */}
          {photos.length > 0 && (
            <Group gap="xs" style={{ overflowX: "auto", flexWrap: "nowrap" }}>
              {photos.map((entry) => (
                <UnstyledButton
                  key={entry.id}
                  onClick={() => setLightbox(entry)}
                  style={{ flexShrink: 0 }}
                  aria-label="Open photo"
                >
                  <PhotoImg
                    hash={entry.photoHash as string}
                    thumbHash={entry.thumbHash}
                    alt={entry.kind === "contents_photo" ? "contents" : "item"}
                    style={{
                      width: 84,
                      height: 84,
                      borderRadius: 8,
                      display: "block",
                    }}
                  />
                </UnstyledButton>
              ))}
            </Group>
          )}

          {/* Notes, newest first */}
          {notes.length > 0 && (
            <Stack gap="xs">
              {notes.map((note) => (
                <Paper key={note.id} p="sm" radius="md" withBorder>
                  <Text style={{ whiteSpace: "pre-wrap" }}>{note.text}</Text>
                  <Group justify="space-between" mt={4}>
                    <Text size="xs" c="dimmed">
                      {(note.deviceId && authors[note.deviceId]) ?? ""}{" "}
                      {relativeTime(note.effectiveTime)}
                    </Text>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      onClick={() =>
                        deleteEntryWithUndo(bin.id, note.id, "Note")
                      }
                      aria-label="Delete note"
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}

          {/* Recovery: anything deleted on any device, restorable for all */}
          <DeletedEntries entries={deleted} authors={authors} />
        </Stack>
      )}

      {/* Bottom ActionBar — the whole point of the page */}
      {bin.status !== "unclaimed" && (
        <Paper
          radius={0}
          p="sm"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            paddingBottom:
              "calc(var(--mantine-spacing-sm) + env(safe-area-inset-bottom))",
            zIndex: 100,
          }}
          withBorder
        >
          <SimpleGrid cols={4} spacing="xs" maw={PAGE_MAXW} mx="auto">
            <Button
              h={56}
              variant="filled"
              onClick={() => setCapture("contents_photo")}
              styles={{ label: { flexDirection: "column", gap: 2 } }}
            >
              <IconCamera size={20} />
              <Text size="xs">Contents</Text>
            </Button>
            <Button
              h={56}
              variant="light"
              onClick={() => setCapture("item_photo")}
              styles={{ label: { flexDirection: "column", gap: 2 } }}
            >
              <IconPackage size={20} />
              <Text size="xs">Item</Text>
            </Button>
            <Button
              h={56}
              variant="light"
              onClick={() => setNoteOpen(true)}
              styles={{ label: { flexDirection: "column", gap: 2 } }}
            >
              <IconNote size={20} />
              <Text size="xs">Note</Text>
            </Button>
            <Button
              h={56}
              variant="light"
              onClick={() => setLocationOpen(true)}
              styles={{ label: { flexDirection: "column", gap: 2 } }}
            >
              <IconMapPin size={20} />
              <Text size="xs">Location</Text>
            </Button>
          </SimpleGrid>
        </Paper>
      )}

      {capture && (
        <CaptureOverlay
          binId={bin.id}
          kind={capture}
          onClose={() => setCapture(null)}
        />
      )}
      <NoteSheet
        binId={bin.id}
        opened={noteOpen}
        onClose={() => setNoteOpen(false)}
      />
      <LocationSheet
        binId={bin.id}
        current={bin.locationName}
        opened={locationOpen}
        onClose={() => setLocationOpen(false)}
      />
      {canPrintLabel && typeof adminPassword === "string" && (
        <LabelPrintSheet
          binId={bin.id}
          adminPassword={adminPassword}
          artAvailable={deployment?.labelArt === true}
          opened={labelOpen}
          onClose={() => setLabelOpen(false)}
        />
      )}

      <LabelSheet
        binId={bin.id}
        labelIds={bin.labelIds}
        weightGrams={bin.weightGrams}
        fillLevel={bin.fillLevel}
        opened={labelsOpen}
        onClose={() => setLabelsOpen(false)}
      />

      <EditBoxSheet
        bin={bin}
        canEditDirectly={canEditDirectly}
        opened={editOpen}
        onClose={() => setEditOpen(false)}
      />

      {/* Lightbox — pages through the whole strip, so it opens on the photo
          that was tapped but isn't limited to it. */}
      <PhotoLightbox
        photos={photos}
        entry={lightbox}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
