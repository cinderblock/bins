/**
 * Access-code join: the bootstrap path (someone must be a member before the
 * first stickers can be allocated), the invite-link target, and the fallback
 * for anyone who reached a box URL without its sticker code. Most people
 * still join by scanning a sticker — the landing offers this as the quiet
 * second option and passes the page to return to in `location.state.next`.
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
import { useDocumentTitle } from "@mantine/hooks";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Navigate, useLocation } from "react-router";
import { adoptIdentity } from "~/lib/auth";
import { IDENTITY_KEY, type Identity, db } from "~/lib/db";
import { rememberAccessCode } from "~/lib/invite";

/** Invite links carry the access code in the fragment (#…); tolerate ?code= too. */
function codeFromUrl(): string {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash.replace(/^#/, "");
  if (hash) return decodeURIComponent(hash.replace(/^code=/i, ""));
  return new URLSearchParams(window.location.search).get("code") ?? "";
}

export default function Join() {
  useDocumentTitle("Join · bins");
  const identity = useLiveQuery(
    async () => ((await db.meta.get(IDENTITY_KEY))?.value as Identity) ?? null,
    [],
    undefined,
  );
  const [displayName, setDisplayName] = useState("");
  const [accessCode, setAccessCode] = useState(codeFromUrl);
  const [geoOk, setGeoOk] = useState(true);
  // Which secret they're presenting. The admin password authorises strictly
  // more than the access code, so someone who has it must never be stuck
  // behind the one they don't — reported by an operator locked out of /admin.
  const [useAdminPassword, setUseAdminPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where to land once joined — the box page someone was trying to reach when
  // the landing sent them here. Only same-origin paths; never a raw URL.
  const state = useLocation().state as { next?: string } | null;
  const next = state?.next && /^\/(?!\/)/.test(state.next) ? state.next : "/";

  if (identity === undefined) return null;
  if (identity !== null) return <Navigate to={next} replace />;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const endpoint = useAdminPassword
        ? "/api/auth/join-by-admin"
        : "/api/auth/join";
      const credential = useAdminPassword
        ? { adminPassword: accessCode }
        : { accessCode };
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...credential,
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
      // Cache the ACCESS CODE only — an admin password is not an invite, and
      // must never end up in a link this device hands to someone else.
      if (!useAdminPassword) await rememberAccessCode(accessCode);
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
            Join with the{" "}
            {useAdminPassword ? "admin password" : "group access code"} and a
            name (shown next to your photos and notes).
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
            label={useAdminPassword ? "Admin password" : "Group access code"}
            value={accessCode}
            onChange={(e) => setAccessCode(e.currentTarget.value)}
            size="lg"
          />
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => {
              setUseAdminPassword((v) => !v);
              setError(null);
            }}
          >
            {useAdminPassword
              ? "I have the group access code instead"
              : "I have the admin password instead"}
          </Anchor>
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
