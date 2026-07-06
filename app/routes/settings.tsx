/**
 * Settings: identity (rename), location consent, group places management,
 * sync/storage status, and the local-reset escape hatch.
 */
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArchive, IconArrowLeft, IconPlus } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { archiveLocation, upsertLocation } from "~/lib/actions";
import { apiJson } from "~/lib/api";
import {
  IDENTITY_KEY,
  type Identity,
  db,
  getMeta,
  resetLocalData,
  setMeta,
} from "~/lib/db";
import { GEO_OPT_IN_KEY, setGeoOptIn } from "~/lib/geo";
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

  const [name, setName] = useState("");
  const [geoOk, setGeoOk] = useState(false);
  const [newPlace, setNewPlace] = useState("");
  const [storage, setStorage] = useState("");

  useEffect(() => {
    if (identity) setName(identity.displayName);
  }, [identity]);
  useEffect(() => {
    void getMeta<boolean>(GEO_OPT_IN_KEY).then((v) => setGeoOk(v ?? false));
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
        </Stack>
      </Paper>

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
