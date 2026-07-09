/**
 * "All boxes" — browse every box in the group. Everyone can open a box and
 * bulk-select boxes to MOVE (relocate) them together. Admins (unlock with the
 * group admin password) additionally see retired boxes and get per-box edit +
 * retire/restore. Retire/restore are server-enforced (api/admin.ts); edit and
 * move ride the normal client ops.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { BinState } from "@shared/reducer";
import {
  IconArchive,
  IconArchiveOff,
  IconArrowLeft,
  IconLock,
  IconMapPin,
  IconPencil,
  IconSearch,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { LabelChips } from "~/components/LabelChips";
import { PhotoImg } from "~/components/PhotoImg";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { WeightInput } from "~/components/WeightInput";
import { setBinFields, setBinLabel, setBinLocation } from "~/lib/actions";
import {
  forgetAdmin,
  rememberAdmin,
  useAdminPassword,
  verifyAdmin,
} from "~/lib/admin";
import { apiJson } from "~/lib/api";
import { db } from "~/lib/db";
import { formatWeight, labelColor } from "~/lib/labels";
import { syncNow } from "~/lib/sync";
import { PAGE_MAXW } from "~/lib/ui";

function usePlaces() {
  return useLiveQuery(
    () =>
      db.locations
        .orderBy("sortOrder")
        .filter((l) => !l.archived)
        .toArray(),
    [],
    [],
  );
}

/** The group's label rows keyed by id, for rendering bins' labelIds as chips. */
function useLabelMap() {
  return useLiveQuery(
    async () => new Map((await db.labels.toArray()).map((l) => [l.id, l])),
    [],
    new Map(),
  );
}

function fail(err: unknown) {
  notifications.show({
    message: err instanceof Error ? err.message : String(err),
    color: "red",
  });
}

export default function Bins() {
  useDocumentTitle("All boxes · bins");
  const navigate = useNavigate();
  const labelById = useLabelMap();

  // Admin unlock is remembered per device (lib/admin.ts): undefined while
  // loading, null when locked, the password string once unlocked here.
  const remembered = useAdminPassword();
  const unlocked = typeof remembered === "string";
  const adminPassword = remembered ?? "";
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPw, setUnlockPw] = useState("");
  const [busy, setBusy] = useState(false);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [editing, setEditing] = useState<BinState | null>(null);

  // Members see active boxes; admins also see retired ones (to restore them).
  const bins = useLiveQuery(
    async () => {
      const all = await db.bins.orderBy("id").toArray();
      return all.filter((bin) =>
        unlocked
          ? bin.status === "active" || bin.status === "retired"
          : bin.status === "active",
      );
    },
    [unlocked],
    undefined,
  );

  async function unlock() {
    setBusy(true);
    try {
      await verifyAdmin(unlockPw);
      await rememberAdmin(unlockPw);
      setUnlockOpen(false);
      setUnlockPw("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancelSelect() {
    setSelecting(false);
    setSelected(new Set());
  }

  function activate(bin: BinState) {
    if (selecting) toggle(bin.id);
    else navigate(`/${bin.id}`);
  }

  async function moveSelected(name: string | null) {
    const ids = [...selected];
    for (const id of ids) await setBinLocation(id, name);
    const n = ids.length;
    notifications.show({
      message: name
        ? `Moved ${n} box${n === 1 ? "" : "es"} to ${name}`
        : `Cleared location on ${n} box${n === 1 ? "" : "es"}`,
      color: "green",
    });
    setMoveOpen(false);
    cancelSelect();
  }

  async function setStatus(binId: number, action: "retire" | "restore") {
    try {
      await apiJson(`/api/admin/bins/${action}`, {
        method: "POST",
        body: JSON.stringify({ adminPassword, binId }),
      });
      await syncNow();
    } catch (err) {
      fail(err);
    }
  }

  if (bins === undefined) return null;

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), env(safe-area-inset-top))"
      gap="md"
      maw={PAGE_MAXW}
      mx="auto"
    >
      <Group justify="space-between">
        <Group gap="sm">
          <ActionIcon
            variant="default"
            size="xl"
            radius="xl"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <IconArrowLeft />
          </ActionIcon>
          <Title order={3}>All boxes</Title>
        </Group>
        <Group gap="xs">
          <ActionIcon
            component={Link}
            to="/search"
            variant="default"
            size="xl"
            radius="xl"
            aria-label="Search"
          >
            <IconSearch />
          </ActionIcon>
          {!selecting &&
            (unlocked ? (
              <Button
                size="xs"
                variant="light"
                color="yellow"
                leftSection={<IconLock size={12} />}
                onClick={() => void forgetAdmin()}
              >
                Lock admin
              </Button>
            ) : (
              <ActionIcon
                variant="default"
                size="xl"
                radius="xl"
                aria-label="Admin controls"
                onClick={() => setUnlockOpen(true)}
              >
                <IconLock />
              </ActionIcon>
            ))}
        </Group>
      </Group>

      {selecting ? (
        <Group justify="space-between">
          <Text fw={600}>{selected.size} selected</Text>
          <Group gap="xs">
            <Button variant="default" onClick={cancelSelect}>
              Cancel
            </Button>
            <Button
              leftSection={<IconMapPin size={16} />}
              disabled={selected.size === 0}
              onClick={() => setMoveOpen(true)}
            >
              Move
            </Button>
          </Group>
        </Group>
      ) : (
        bins.length > 0 && (
          <Button
            variant="light"
            onClick={() => setSelecting(true)}
            style={{ alignSelf: "flex-start" }}
          >
            Select to move
          </Button>
        )
      )}

      {bins.length === 0 && (
        <Text c="dimmed" ta="center" mt="xl">
          No boxes yet.
        </Text>
      )}

      <Stack gap="xs">
        {bins.map((bin) => {
          const retired = bin.status === "retired";
          return (
            <Paper
              key={bin.id}
              p="sm"
              radius="md"
              withBorder
              style={{ opacity: retired ? 0.6 : 1 }}
            >
              <Group wrap="nowrap" gap="sm">
                {selecting && (
                  <Checkbox
                    checked={selected.has(bin.id)}
                    readOnly
                    tabIndex={-1}
                  />
                )}
                <UnstyledButton
                  onClick={() => activate(bin)}
                  aria-label={
                    selecting ? `Select box ${bin.id}` : `Open box ${bin.id}`
                  }
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Group wrap="nowrap">
                    {bin.primaryPhotoHash ? (
                      <PhotoImg
                        hash={bin.primaryPhotoHash}
                        thumbHash={bin.primaryThumbHash}
                        alt=""
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          background: "var(--mantine-color-dark-5)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={8}>
                        <Text fw={600}>#{bin.id}</Text>
                        {bin.name && <Text truncate>{bin.name}</Text>}
                        {retired && (
                          <Badge color="gray" size="sm">
                            retired
                          </Badge>
                        )}
                      </Group>
                      <Group gap={6}>
                        {bin.locationName && (
                          <Badge
                            variant="light"
                            leftSection={<IconMapPin size={12} />}
                            style={{ textTransform: "none" }}
                          >
                            {bin.locationName}
                          </Badge>
                        )}
                        {bin.weightGrams != null && (
                          <Badge variant="light" color="gray">
                            {formatWeight(bin.weightGrams)}
                          </Badge>
                        )}
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
                        {bin.externalLabel && (
                          <Text size="xs" c="dimmed" truncate>
                            {bin.externalLabel}
                          </Text>
                        )}
                      </Group>
                    </div>
                  </Group>
                </UnstyledButton>
                {unlocked && !selecting && (
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Edit box ${bin.id}`}
                      onClick={() => setEditing(bin)}
                    >
                      <IconPencil size={18} />
                    </ActionIcon>
                    {retired ? (
                      <ActionIcon
                        variant="subtle"
                        color="green"
                        aria-label={`Restore box ${bin.id}`}
                        onClick={() => void setStatus(bin.id, "restore")}
                      >
                        <IconArchiveOff size={18} />
                      </ActionIcon>
                    ) : (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Retire box ${bin.id}`}
                        onClick={() => void setStatus(bin.id, "retire")}
                      >
                        <IconArchive size={18} />
                      </ActionIcon>
                    )}
                  </Group>
                )}
              </Group>
            </Paper>
          );
        })}
      </Stack>

      <Modal
        opened={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title="Admin controls"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Unlock per-box editing and retire/restore with the group admin
            password.
          </Text>
          <PasswordInput
            label="Admin password"
            value={unlockPw}
            onChange={(e) => setUnlockPw(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && unlockPw && void unlock()}
            autoFocus
          />
          <Button
            onClick={() => void unlock()}
            loading={busy}
            disabled={!unlockPw}
          >
            Unlock
          </Button>
        </Stack>
      </Modal>

      <MoveSheet
        opened={moveOpen}
        count={selected.size}
        onClose={() => setMoveOpen(false)}
        onPick={moveSelected}
      />

      {editing && <EditSheet bin={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

function MoveSheet({
  opened,
  count,
  onClose,
  onPick,
}: {
  opened: boolean;
  count: number;
  onClose: () => void;
  onPick: (name: string | null) => void | Promise<void>;
}) {
  const places = usePlaces();
  const [freeform, setFreeform] = useState("");
  const pick = (name: string | null) => {
    void onPick(name);
    setFreeform("");
  };
  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title={`Move ${count} box${count === 1 ? "" : "es"} to…`}
    >
      <Stack gap="xs" pb="env(safe-area-inset-bottom)">
        {places.map((place) => (
          <Button
            key={place.id}
            size="lg"
            variant="light"
            onClick={() => pick(place.name)}
          >
            {place.name}
          </Button>
        ))}
        <Group gap="xs" mt="xs">
          <TextInput
            placeholder="somewhere else…"
            value={freeform}
            onChange={(e) => setFreeform(e.currentTarget.value)}
            size="lg"
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeform.trim()) pick(freeform.trim());
            }}
          />
          <Button
            size="lg"
            variant="default"
            disabled={!freeform.trim()}
            onClick={() => pick(freeform.trim())}
          >
            Set
          </Button>
        </Group>
        <Button
          size="sm"
          variant="subtle"
          color="gray"
          onClick={() => pick(null)}
        >
          Clear location
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}

function EditSheet({ bin, onClose }: { bin: BinState; onClose: () => void }) {
  const [name, setName] = useState(bin.name ?? "");
  const [label, setLabel] = useState(bin.externalLabel ?? "");
  const [locationName, setLocationName] = useState(bin.locationName ?? "");
  const [weightGrams, setWeightGrams] = useState<number | null>(
    bin.weightGrams,
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await setBinFields(bin.id, {
        name: name.trim() || null,
        externalLabel: label.trim() || null,
        weightGrams,
      });
      if ((locationName.trim() || null) !== (bin.locationName ?? null)) {
        await setBinLocation(bin.id, locationName.trim() || null);
      }
      notifications.show({ message: `Saved #${bin.id}`, color: "green" });
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet opened onClose={onClose} title={`Edit #${bin.id}`}>
      <Stack gap="sm" pb="env(safe-area-inset-bottom)">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          label="Location"
          value={locationName}
          onChange={(e) => setLocationName(e.currentTarget.value)}
        />
        <TextInput
          label="External label"
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <WeightInput grams={weightGrams} onChange={setWeightGrams} />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Categories
          </Text>
          {/* Membership applies immediately (the bin already exists). */}
          <LabelChips
            selected={new Set(bin.labelIds)}
            onToggle={(labelId, present) =>
              void setBinLabel(bin.id, labelId, present)
            }
          />
        </div>
        <Button onClick={() => void save()} loading={busy}>
          Save
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}
