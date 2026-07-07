/**
 * The UNLINKED access-code join — nothing in the UI points here. It exists
 * as the bootstrap path (someone must be a member before the first stickers
 * can be allocated) and as a fallback for operators. Everyone else joins by
 * scanning a sticker.
 */
import {
  Button,
  Checkbox,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Navigate } from "react-router";
import { adoptIdentity } from "~/lib/auth";
import { IDENTITY_KEY, type Identity, db } from "~/lib/db";

export default function Join() {
  const identity = useLiveQuery(
    async () => ((await db.meta.get(IDENTITY_KEY))?.value as Identity) ?? null,
    [],
    undefined,
  );
  const [displayName, setDisplayName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [geoOk, setGeoOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (identity === undefined) return null;
  if (identity !== null) return <Navigate to="/" replace />;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch("/api/auth/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessCode,
            displayName: displayName.trim(),
            deviceId: crypto.randomUUID(),
          }),
        });
        if (response.status !== 409) break;
      }
      if (!response || !response.ok) {
        const body = (await response?.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "could not join");
      }
      await adoptIdentity((await response.json()) as Identity, geoOk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container size="xs" pt="15dvh">
      <Paper p="lg" radius="lg" withBorder>
        <Stack>
          <Title order={2}>bins</Title>
          <Text c="dimmed" size="sm">
            Join with the group access code and a name (shown next to your
            photos and notes).
          </Text>
          <TextInput
            label="Your name"
            placeholder="e.g. Sam"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            size="lg"
            autoFocus
          />
          <PasswordInput
            label="Group access code"
            value={accessCode}
            onChange={(e) => setAccessCode(e.currentTarget.value)}
            size="lg"
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
            onClick={() => void join()}
            loading={busy}
            disabled={!displayName.trim() || !accessCode}
          >
            Join
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
