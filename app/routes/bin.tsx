/**
 * The bin page — one URL per physical box, opened by scanning its sticker.
 * One-handed layout: fixed bottom ActionBar (Contents / Item / Note /
 * Location), scrollable content above (header, primary photo, photo strip,
 * notes). Unclaimed bins render the claim panel in place; bins not in the
 * replica (foreign group or not yet synced) get a helpful dead-end.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Group,
  Image,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { EntryState } from "@shared/reducer";
import {
  IconArrowLeft,
  IconCamera,
  IconMapPin,
  IconNote,
  IconPackage,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CaptureOverlay } from "~/components/CaptureOverlay";
import { ClaimBin } from "~/components/ClaimBin";
import { LabelSheet } from "~/components/LabelSheet";
import { LocationSheet } from "~/components/LocationSheet";
import { NoteSheet } from "~/components/NoteSheet";
import { PhotoImg, usePhotoUrl } from "~/components/PhotoImg";
import { SyncBadge } from "~/components/SyncBadge";
import { removeEntry } from "~/lib/actions";
import { db } from "~/lib/db";
import { relativeTime } from "~/lib/format";
import { formatWeight, labelColor } from "~/lib/labels";
import { syncNow } from "~/lib/sync";

const ACTION_BAR_HEIGHT = 88;

export default function BinPage() {
  const params = useParams();
  const navigate = useNavigate();
  const binId = /^\d{1,9}$/.test(params.binId ?? "")
    ? Number(params.binId)
    : null;

  const bin = useLiveQuery(
    async () => (binId !== null ? ((await db.bins.get(binId)) ?? null) : null),
    [binId],
    undefined,
  );
  const entries = useLiveQuery(
    async () =>
      binId !== null
        ? (await db.entries.where("binId").equals(binId).toArray())
            .filter((e) => !e.deletedByOpId)
            .sort((a, b) => b.effectiveTime - a.effectiveTime)
        : [],
    [binId],
    [],
  );
  const authors = useLiveQuery(
    async () => {
      const devices = (await db.meta.get("devices"))?.value as
        | Record<string, string>
        | undefined;
      const identity = (await db.meta.get("identity"))?.value as
        | { deviceId: string; displayName: string }
        | undefined;
      return {
        ...devices,
        ...(identity ? { [identity.deviceId]: identity.displayName } : {}),
      };
    },
    [],
    {} as Record<string, string>,
  );

  // The group's label rows, to render a bin's labelIds as named, colored chips.
  const labelById = useLiveQuery(
    async () => new Map((await db.labels.toArray()).map((l) => [l.id, l])),
    [],
    new Map(),
  );

  const [capture, setCapture] = useState<
    null | "contents_photo" | "item_photo"
  >(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<EntryState | null>(null);

  if (binId === null) {
    return (
      <Center h="100dvh">
        <Text>Not a bin number.</Text>
      </Center>
    );
  }

  if (bin === undefined) return null;

  if (bin === null) {
    return (
      <Center h="100dvh" p="md">
        <Stack align="center">
          <Title order={3}>Bin #{binId} isn't here</Title>
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

  const photos = entries.filter((e) => e.photoHash);
  const notes = entries.filter((e) => e.kind === "note");

  return (
    <div style={{ minHeight: "100dvh", paddingBottom: ACTION_BAR_HEIGHT + 24 }}>
      {/* Top bar */}
      <Group
        justify="space-between"
        p="sm"
        pt="max(var(--mantine-spacing-sm), env(safe-area-inset-top))"
      >
        <Group gap="sm">
          <ActionIcon
            variant="default"
            size="xl"
            radius="xl"
            onClick={() => navigate("/")}
            aria-label="Back to scanner"
          >
            <IconArrowLeft />
          </ActionIcon>
          <div>
            <Group gap={8}>
              <Title order={3}>#{bin.id}</Title>
              {bin.sizeClass && <Badge variant="light">{bin.sizeClass}</Badge>}
              {bin.weightGrams != null && (
                <Badge variant="light" color="gray">
                  {formatWeight(bin.weightGrams)}
                </Badge>
              )}
              {bin.status === "retired" && <Badge color="gray">retired</Badge>}
            </Group>
            {bin.name && <Text size="sm">{bin.name}</Text>}
          </div>
        </Group>
        <SyncBadge />
      </Group>

      {bin.status === "unclaimed" ? (
        <ClaimBin binId={bin.id} />
      ) : (
        <Stack gap="md" px="md">
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
              {bin.labelIds.length > 0 ? "Edit" : "Add categories"}
            </Button>
          </Group>

          {/* Primary photo (latest top-down contents shot) */}
          {bin.primaryPhotoHash ? (
            <PhotoImg
              hash={bin.primaryPhotoHash}
              alt={`Contents of bin ${bin.id}`}
              preferFull
              style={{ width: "100%", borderRadius: 12, maxHeight: "45dvh" }}
            />
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
                      onClick={() => void removeEntry(bin.id, note.id)}
                      aria-label="Delete note"
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
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
          <SimpleGrid cols={4} spacing="xs">
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
      <LabelSheet
        binId={bin.id}
        labelIds={bin.labelIds}
        weightGrams={bin.weightGrams}
        opened={labelsOpen}
        onClose={() => setLabelsOpen(false)}
      />

      {/* Lightbox */}
      <Modal
        opened={lightbox !== null}
        onClose={() => setLightbox(null)}
        fullScreen
        padding="xs"
        title={
          lightbox && (
            <Text size="sm" c="dimmed">
              {lightbox.kind === "contents_photo" ? "Contents" : "Item"} ·{" "}
              {(lightbox.deviceId && authors[lightbox.deviceId]) ?? ""}{" "}
              {relativeTime(lightbox.effectiveTime)}
            </Text>
          )
        }
      >
        {lightbox?.photoHash && (
          <Lightbox entry={lightbox} onDeleted={() => setLightbox(null)} />
        )}
      </Modal>
    </div>
  );
}

function Lightbox({
  entry,
  onDeleted,
}: { entry: EntryState; onDeleted: () => void }) {
  const url = usePhotoUrl(entry.photoHash, null, true);
  return (
    <Stack>
      {url ? (
        <Image src={url} radius="md" alt="photo" fit="contain" mah="75dvh" />
      ) : (
        <Center h={200}>
          <Text c="dimmed">loading…</Text>
        </Center>
      )}
      <Button
        color="red"
        variant="light"
        leftSection={<IconTrash size={16} />}
        onClick={() => {
          void removeEntry(entry.binId, entry.id);
          onDeleted();
        }}
      >
        Delete photo
      </Button>
    </Stack>
  );
}
