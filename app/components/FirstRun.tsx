/**
 * First-run onboarding. Two ways in, both minting the same device token:
 * scanning a sticker (`/{id}#{CODE}` — proof of physical access, name-only
 * join) or the shared group access code (bootstrap path + fallback).
 * Everything persists on this device until "leave group".
 */
import {
  Anchor,
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
import { useState } from "react";
import { useNavigate } from "react-router";
import { setCachedToken } from "~/lib/api";
import { IDENTITY_KEY, type Identity, setMeta } from "~/lib/db";
import { setGeoOptIn } from "~/lib/geo";
import { syncNow } from "~/lib/sync";

export function FirstRun({
  sticker,
}: {
  /** Set when the app was opened on a sticker URL while unauthenticated. */
  sticker?: { binId: number; code: string } | null;
}) {
  const [displayName, setDisplayName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [geoOk, setGeoOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceAccessCode, setForceAccessCode] = useState(false);
  const byBin = !!sticker && !forceAccessCode;
  const navigate = useNavigate();

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const path = byBin ? "/api/auth/join-by-bin" : "/api/auth/join";
      // Retry once with a fresh uuid on the (theoretical) device-id collision.
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(byBin
              ? { binId: sticker.binId, code: sticker.code }
              : { accessCode }),
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
      const identity = (await response.json()) as Identity;
      await setMeta(IDENTITY_KEY, identity);
      setCachedToken(identity.token);
      await setGeoOptIn(geoOk);
      // Ask the browser not to evict our replica + unsynced photos.
      void navigator.storage?.persist?.();
      void syncNow();
      // Drop the sticker code from the URL — it's only for joining, and the
      // canonical bin URL is what belongs in history/share sheets.
      if (sticker) navigate(`/${sticker.binId}`, { replace: true });
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
            {byBin
              ? `You scanned bin #${sticker.binId} — that's your ticket in. Just add a name (shown next to your photos and notes).`
              : "Scan a box, see what's inside. Enter your group's access code and a name (shown next to your photos and notes)."}
          </Text>
          <TextInput
            label="Your name"
            placeholder="e.g. Sam"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            size="lg"
            autoFocus
          />
          {!byBin && (
            <PasswordInput
              label="Group access code"
              value={accessCode}
              onChange={(e) => setAccessCode(e.currentTarget.value)}
              size="lg"
            />
          )}
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
            disabled={!displayName.trim() || (!byBin && !accessCode)}
          >
            Join
          </Button>
          {byBin && (
            <Anchor
              component="button"
              type="button"
              size="sm"
              c="dimmed"
              onClick={() => setForceAccessCode(true)}
            >
              Join with the group access code instead
            </Anchor>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
