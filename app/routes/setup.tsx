/**
 * First-boot setup: shown (via the landing redirect) only while the server
 * has zero groups. Creates the group — name, landing branding, member access
 * code, admin password — and joins this browser as the first member in one
 * step. Locked forever after.
 */
import {
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import { IconRefresh } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { adoptIdentity } from "~/lib/auth";
import { IDENTITY_KEY, type Identity, db } from "~/lib/db";
import { rememberAccessCode } from "~/lib/invite";

/** Member access codes are typed on phones — lowercase, no confusables. */
function generateAccessCode(): string {
  const alphabet = "23456789abcdefghjkmnpqrstvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export default function Setup() {
  useDocumentTitle("Set up · bins");
  const identity = useLiveQuery(
    async () => ((await db.meta.get(IDENTITY_KEY))?.value as Identity) ?? null,
    [],
    undefined,
  );
  const [available, setAvailable] = useState<boolean | null>(null);
  const [groupName, setGroupName] = useState("");
  const [landingTitle, setLandingTitle] = useState("");
  const [landingSubtitle, setLandingSubtitle] = useState("");
  const [accessCode, setAccessCode] = useState(generateAccessCode);
  const [adminPassword, setAdminPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [geoOk, setGeoOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/landing")
      .then((res) => res.json())
      .then((body: { needsSetup: boolean }) => setAvailable(body.needsSetup))
      .catch(() => setAvailable(false));
  }, []);

  if (identity === undefined || available === null) return null;
  if (identity !== null) return <Navigate to="/" replace />;
  if (!available) return <Navigate to="/" replace />;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName: groupName.trim(),
          landingTitle: landingTitle.trim() || null,
          landingSubtitle: landingSubtitle.trim() || null,
          accessCode,
          adminPassword,
          displayName: displayName.trim(),
          deviceId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "setup failed");
      }
      await adoptIdentity((await response.json()) as Identity, geoOk);
      // The operator's device keeps the code so it can share invite links.
      await rememberAccessCode(accessCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setBusy(false);
    }
  }

  const name = groupName.trim();
  return (
    <Container size="xs" py="10dvh">
      <Paper p="lg" radius="lg" withBorder>
        <Stack>
          <Title order={2}>Set up bins</Title>
          <Text c="dimmed" size="sm">
            Fresh server — create your group. You'll be its first member.
          </Text>
          <TextInput
            label="Group name"
            placeholder="e.g. River City Makerspace"
            value={groupName}
            onChange={(e) => setGroupName(e.currentTarget.value)}
            size="lg"
            autoFocus
          />
          <TextInput
            label="Landing page title"
            placeholder={
              name ? `${name} Inventory Management System` : "(from group name)"
            }
            description="Shown to signed-out visitors. Leave empty for the default."
            value={landingTitle}
            onChange={(e) => setLandingTitle(e.currentTarget.value)}
          />
          <TextInput
            label="Landing page subtitle"
            placeholder="Scan a Box to Start"
            value={landingSubtitle}
            onChange={(e) => setLandingSubtitle(e.currentTarget.value)}
          />
          <Divider />
          <Group gap="xs" align="flex-end">
            <TextInput
              label="Member access code"
              description="The unlisted /join fallback — members normally join by scanning a sticker."
              value={accessCode}
              onChange={(e) => setAccessCode(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              variant="default"
              onClick={() => setAccessCode(generateAccessCode())}
              aria-label="Generate a new access code"
            >
              <IconRefresh size={16} />
            </Button>
          </Group>
          <PasswordInput
            label="Admin password"
            description="Gates the admin page (branding, sticker import, devices)."
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.currentTarget.value)}
          />
          <Divider />
          <TextInput
            label="Your name"
            placeholder="e.g. Sam"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
          />
          <Checkbox
            checked={geoOk}
            onChange={(e) => setGeoOk(e.currentTarget.checked)}
            label="Record where things were last seen (location on photos/notes)"
          />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Button
            size="lg"
            onClick={() => void create()}
            loading={busy}
            disabled={
              !name ||
              accessCode.length < 4 ||
              adminPassword.length < 4 ||
              !displayName.trim()
            }
          >
            Create group &amp; start
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
