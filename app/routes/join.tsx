/**
 * Access-code join: the bootstrap path (someone must be a member before the
 * first stickers can be allocated), the invite-link target, and the fallback
 * for anyone who reached a box URL without its sticker code. Most people
 * still join by scanning a sticker — the landing offers this as the quiet
 * second option and passes the page to return to in `location.state.next`.
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
import { useDocumentTitle } from "@mantine/hooks";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Navigate, useLocation } from "react-router";
import { rememberAdmin } from "~/lib/admin";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where to land once joined — the box page someone was trying to reach when
  // the landing sent them here. Only same-origin paths; never a raw URL.
  const state = useLocation().state as { next?: string } | null;
  const next = state?.next && /^\/(?!\/)/.test(state.next) ? state.next : "/";

  if (identity === undefined) return null;
  if (identity !== null) return <Navigate to={next} replace />;

  /** One join attempt; retries once on 409 (a device-id collision). */
  async function post(
    endpoint: string,
    credential: Record<string, string>,
  ): Promise<Response | null> {
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
    return response;
  }

  /**
   * One field, either secret.
   *
   * Asking which KIND of code you hold is a question only the system cares
   * about — you just have "the code someone gave me". So try the access code,
   * and on a rejection try the same text as the admin password. Whichever
   * matches decides what you get: an admin lands with /admin already unlocked
   * instead of being asked for the very password they just typed.
   */
  async function join() {
    setBusy(true);
    setError(null);
    try {
      const secret = accessCode;
      let response = await post("/api/auth/join", { accessCode: secret });
      let joinedAsAdmin = false;
      if (response && response.status === 403) {
        const asAdmin = await post("/api/auth/join-by-admin", {
          adminPassword: secret,
        });
        if (asAdmin?.ok) {
          response = asAdmin;
          joinedAsAdmin = true;
        }
      }
      if (!response || !response.ok) {
        // Deliberately does NOT say which secret was wrong — that would turn
        // this box into an oracle for "is this string the admin password?".
        throw new Error("That code didn’t match. Check it and try again.");
      }
      await adoptIdentity((await response.json()) as Identity, geoOk);
      if (joinedAsAdmin) {
        // Typing it here IS a successful verification, so unlock admin on this
        // device. Never cached as an invite code: an invite is meant to be
        // handed to someone else, and this is the one secret that must not be.
        await rememberAdmin(secret);
      } else {
        await rememberAccessCode(secret);
      }
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
            Join with the group code and a name (shown next to your photos and
            notes). An admin password works here too, and unlocks admin.
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
            label="Access code or admin password"
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
