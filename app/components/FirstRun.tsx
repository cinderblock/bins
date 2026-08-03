/**
 * Sticker-join onboarding: landing on `/{id}#{CODE}` unauthenticated means
 * the person is holding a real sticker — proof of physical access — so
 * joining takes just a name. This is the ONLY visible entry point; the
 * access-code form lives at the unlinked /join route (bootstrap/fallback).
 */
import {
  Button,
  Checkbox,
  Container,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { adoptIdentity } from "~/lib/auth";
import type { Identity } from "~/lib/db";

/**
 * Either the person is holding a sticker (`sticker`), or the deployment is
 * perimeter-protected and being on the network is itself the proof
 * (`sticker: null`). Both paths mint the same device token and both still ask
 * for a name — that name is what every photo and note is attributed to.
 */
export function FirstRun({
  sticker,
}: {
  sticker: { binId: number; code: string } | null;
}) {
  const [displayName, setDisplayName] = useState("");
  const [geoOk, setGeoOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      // Retry once with a fresh uuid on the (theoretical) device-id collision.
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(
          sticker ? "/api/auth/join-by-bin" : "/api/auth/join-open",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(sticker ? { binId: sticker.binId, code: sticker.code } : {}),
              displayName: displayName.trim(),
              deviceId: crypto.randomUUID(),
            }),
          },
        );
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
            {sticker
              ? `You scanned bin #${sticker.binId} — that's your ticket in. Just add a name (shown next to your photos and notes).`
              : "Add a name to get started — it's shown next to your photos and notes."}
          </Text>
          <TextInput
            label="Your name"
            placeholder="e.g. Sam"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            size="lg"
            autoFocus
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
            disabled={!displayName.trim()}
          >
            Join
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
