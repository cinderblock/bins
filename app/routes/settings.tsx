/**
 * Settings: identity (rename), location consent, group places management,
 * sync/storage status, and the local-reset escape hatch.
 */
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Paper,
  PasswordInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArchive,
  IconArrowLeft,
  IconDeviceMobilePlus,
  IconPlus,
  IconShieldLock,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { archiveLocation, upsertLocation } from "~/lib/actions";
import { apiJson } from "~/lib/api";
import { signBackIn } from "~/lib/auth";
import {
  AUTH_DEAD_KEY,
  IDENTITY_KEY,
  type Identity,
  db,
  getMeta,
  resetLocalData,
  setMeta,
} from "~/lib/db";
import { GEO_OPT_IN_KEY, setGeoOptIn } from "~/lib/geo";
import {
  canPromptInstall,
  isIos,
  isStandalone,
  onInstallStateChange,
  promptInstall,
} from "~/lib/install";
import {
  DEFAULT_PHOTO_RETENTION,
  type PhotoRetention,
  getPhotoRetention,
  setPhotoRetention,
} from "~/lib/photos";
import { syncNow } from "~/lib/sync";

export default function Settings() {
  const navigate = useNavigate();
  const identity = useLiveQuery(
    async () =>
      (await db.meta.get(IDENTITY_KEY))?.value as Identity | undefined,
    [],
    undefined,
  );
  const pendingOps = useLiveQuery(() => db.pendingOps.count(), [], 0);
  const pendingBlobs = useLiveQuery(
    () => db.blobs.where("status").equals("pending").count(),
    [],
    0,
  );
  const places = useLiveQuery(
    () =>
      db.locations
        .orderBy("sortOrder")
        .filter((l) => !l.archived)
        .toArray(),
    [],
    [],
  );

  const authDead = useLiveQuery(
    async () => (await db.meta.get(AUTH_DEAD_KEY))?.value === true,
    [],
    false,
  );

  const [name, setName] = useState("");
  const [geoOk, setGeoOk] = useState(false);
  const [newPlace, setNewPlace] = useState("");
  const [storage, setStorage] = useState("");
  const [retention, setRetention] = useState<PhotoRetention>(
    DEFAULT_PHOTO_RETENTION,
  );
  const [rejoinCode, setRejoinCode] = useState("");
  const [rejoining, setRejoining] = useState(false);
  // Re-render when the browser hands us (or consumes) the install prompt.
  const [, setInstallTick] = useState(0);
  useEffect(() => onInstallStateChange(() => setInstallTick((n) => n + 1)), []);

  useEffect(() => {
    if (identity) setName(identity.displayName);
  }, [identity]);
  useEffect(() => {
    void getMeta<boolean>(GEO_OPT_IN_KEY).then((v) => setGeoOk(v ?? false));
    void getPhotoRetention().then(setRetention);
    void navigator.storage?.estimate?.().then((est) => {
      if (est.usage != null) {
        setStorage(`${(est.usage / 1024 / 1024).toFixed(1)} MB used locally`);
      }
    });
  }, []);

  async function rename() {
    if (!identity || !name.trim()) return;
    await apiJson("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ displayName: name.trim() }),
    });
    await setMeta(IDENTITY_KEY, { ...identity, displayName: name.trim() });
    notifications.show({ message: "Name updated", color: "green" });
  }

  async function rejoin() {
    setRejoining(true);
    try {
      await signBackIn(rejoinCode);
      setRejoinCode("");
      notifications.show({
        message: "Signed back in — syncing queued changes",
        color: "green",
      });
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : "could not sign in",
        color: "red",
      });
    } finally {
      setRejoining(false);
    }
  }

  async function addPlace() {
    const trimmed = newPlace.trim();
    if (!trimmed) return;
    await upsertLocation(
      crypto.randomUUID(),
      trimmed,
      (places.at(-1)?.sortOrder ?? 0) + 1,
    );
    setNewPlace("");
  }

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), env(safe-area-inset-top))"
      maw={480}
      mx="auto"
    >
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
        <Title order={3}>Settings</Title>
      </Group>

      {authDead && (
        <Alert color="red" title="This device was signed out">
          <Stack gap="xs">
            <Text size="sm">
              The server no longer accepts this device's key, so changes are
              piling up locally ({pendingOps + pendingBlobs} waiting — nothing
              is lost). Enter the group access code to reconnect.
            </Text>
            <Group gap="xs" align="flex-end">
              <PasswordInput
                label="Group access code"
                value={rejoinCode}
                onChange={(e) => setRejoinCode(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button
                onClick={() => void rejoin()}
                loading={rejoining}
                disabled={!rejoinCode}
              >
                Sign back in
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}

      <Paper p="md" radius="lg" withBorder>
        <Stack gap="sm">
          <Text fw={600}>{identity?.groupName}</Text>
          <Group align="flex-end" gap="xs">
            <TextInput
              label="Your name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button variant="default" onClick={() => void rename()}>
              Save
            </Button>
          </Group>
          <Switch
            checked={geoOk}
            onChange={(e) => {
              setGeoOk(e.currentTarget.checked);
              void setGeoOptIn(e.currentTarget.checked);
            }}
            label="Record location on photos and notes"
          />
        </Stack>
      </Paper>

      <Paper p="md" radius="lg" withBorder>
        <Stack gap="xs">
          <Text fw={600}>Places</Text>
          <Text size="xs" c="dimmed">
            The quick options in the location picker.
          </Text>
          {places.map((place) => (
            <Group key={place.id} justify="space-between">
              <Text>{place.name}</Text>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => void archiveLocation(place.id, true)}
                aria-label={`Archive ${place.name}`}
              >
                <IconArchive size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Group gap="xs">
            <TextInput
              placeholder="e.g. shelf A2"
              value={newPlace}
              onChange={(e) => setNewPlace(e.currentTarget.value)}
              style={{ flex: 1 }}
              onKeyDown={(e) => e.key === "Enter" && void addPlace()}
            />
            <ActionIcon
              size="lg"
              variant="default"
              onClick={() => void addPlace()}
              aria-label="Add place"
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Group>
        </Stack>
      </Paper>

      <Paper p="md" radius="lg" withBorder>
        <Stack gap="xs">
          <Text fw={600}>Sync</Text>
          <Text size="sm" c="dimmed">
            {pendingOps} ops and {pendingBlobs} photos waiting to upload.
            {storage && ` ${storage}.`}
          </Text>
          <Button variant="default" onClick={() => void syncNow()}>
            Sync now
          </Button>
          <div>
            <Text size="sm" fw={500} mb={4}>
              Keep photos offline
            </Text>
            <SegmentedControl
              fullWidth
              value={retention}
              onChange={(value) => {
                setRetention(value as PhotoRetention);
                void setPhotoRetention(value as PhotoRetention);
              }}
              data={[
                { label: "1 week", value: "week" },
                { label: "1 month", value: "month" },
                { label: "Forever", value: "forever" },
              ]}
            />
            <Text size="xs" c="dimmed" mt={4}>
              How long full-size photos stay on this device after you view them.
              Thumbnails and each box's latest photo are always kept; anything
              evicted re-downloads when you next open it online. Pick "Forever"
              for event weeks spent off-grid.
            </Text>
          </div>
        </Stack>
      </Paper>

      <Paper p="md" radius="lg" withBorder>
        <Stack gap="xs">
          <Text fw={600}>Administration</Text>
          <Text size="xs" c="dimmed">
            Landing page text, importing pre-printed stickers, device
            revocation. Needs the group's admin password.
          </Text>
          <Button
            variant="default"
            leftSection={<IconShieldLock size={16} />}
            onClick={() => navigate("/admin")}
          >
            Open admin
          </Button>
        </Stack>
      </Paper>

      {!isStandalone() && (
        <Paper p="md" radius="lg" withBorder>
          <Stack gap="xs">
            <Group gap="xs">
              <IconDeviceMobilePlus size={18} />
              <Text fw={600}>Install on your home screen</Text>
            </Group>
            <Text size="sm" c="dimmed">
              Installed, the app starts instantly offline and the browser treats
              your local photos and pending changes as much safer from storage
              cleanup.
            </Text>
            {canPromptInstall() ? (
              <Button onClick={() => void promptInstall()}>Install</Button>
            ) : (
              <Text size="sm">
                {isIos()
                  ? "In Safari: tap the Share button, then “Add to Home Screen”."
                  : "In your browser menu, choose “Install app” or “Add to Home Screen”."}
              </Text>
            )}
          </Stack>
        </Paper>
      )}

      <Divider />
      <Button
        color="red"
        variant="light"
        onClick={() => {
          if (pendingOps + pendingBlobs > 0) {
            notifications.show({
              message:
                "There are unsynced changes — sync first or they'll be lost.",
              color: "red",
            });
            return;
          }
          void resetLocalData();
        }}
      >
        Leave group (clear this device)
      </Button>
    </Stack>
  );
}
