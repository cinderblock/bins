/**
 * The gate a visitor meets OFF the deployment's network, on a deployment
 * that lets passkey holders in from outside (`REMOTE_ACCESS=passkey`).
 *
 * Two situations, one card:
 * - no identity on this device (a fresh browser, typically a phone on
 *   cellular): a passkey sign-in mints a device for this browser, already
 *   admin — a name is asked for so the device's edits are attributed;
 * - a joined device the server has refused with "passkey required" (a
 *   member who took the phone off-site, or an admin whose session ran out):
 *   the same sign-in makes the existing device admin again.
 *
 * Passkeys are the only way through on purpose: from the internet, no
 * access code, no sticker, no password — see api/config.ts.
 */
import {
  Button,
  Container,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconFingerprint } from "@tabler/icons-react";
import { useState } from "react";
import { ADMIN_VIA_PASSKEY, rememberAdmin } from "~/lib/admin";
import { REMOTE_LOCKED_KEY, setMeta } from "~/lib/db";
import { refreshDeployment, useDeployment } from "~/lib/deployment";
import { loginWithPasskey, passkeysSupported } from "~/lib/passkeys";
import { syncNow } from "~/lib/sync";

export function RemoteSignIn({
  /** A device that is joined but has been refused — keep its identity. */
  locked = false,
  groupName,
}: {
  locked?: boolean;
  groupName?: string;
}) {
  const deployment = useDeployment();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = passkeysSupported();
  const anyPasskey = deployment?.passkeys !== false;
  const needsName = !locked;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey(
        needsName ? { displayName: displayName.trim() } : undefined,
      );
      await rememberAdmin(ADMIN_VIA_PASSKEY);
      // The refusal is over; let queued work flow.
      await setMeta(REMOTE_LOCKED_KEY, false);
      void syncNow();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A cancelled prompt is not an error worth showing.
      if (!/abort|cancel|NotAllowedError/i.test(message)) setError(message);
    } finally {
      setBusy(false);
    }
  }

  // Back on the network, the refusal no longer applies — offer to check.
  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await refreshDeployment();
      await syncNow();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container size="xs" py="xl">
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={2}>
            {locked ? "Sign in again to continue" : "Sign in"}
          </Title>
          <Text c="dimmed">
            {groupName ? `${groupName} is` : "This is"} being reached from
            outside its network. From here, only an admin with a saved passkey
            can sign in — everyone else uses it on the local network.
          </Text>
        </Stack>

        <Paper p="md" radius="lg" withBorder>
          <Stack gap="sm">
            {!anyPasskey ? (
              <Text size="sm" c="dimmed">
                No passkey has been set up for this group yet. Open Admin →
                Passkeys on the local network first.
              </Text>
            ) : !supported ? (
              <Text size="sm" c="dimmed">
                This browser can't use passkeys. Open this page in the phone's
                own browser, or on a computer with a fingerprint or face unlock.
              </Text>
            ) : (
              <>
                {needsName && (
                  <TextInput
                    label="Your name"
                    description="What your edits are attributed to on this device."
                    value={displayName}
                    onChange={(e) => setDisplayName(e.currentTarget.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && displayName.trim() && void signIn()
                    }
                    autoFocus
                  />
                )}
                <Button
                  size="md"
                  leftSection={<IconFingerprint size={18} />}
                  loading={busy}
                  disabled={needsName && !displayName.trim()}
                  onClick={() => void signIn()}
                >
                  Sign in with a passkey
                </Button>
              </>
            )}
            {error && (
              <Text size="sm" c="red">
                {error}
              </Text>
            )}
          </Stack>
        </Paper>

        {locked && (
          <Button variant="subtle" loading={busy} onClick={() => void retry()}>
            I'm back on the network — try again
          </Button>
        )}
      </Stack>
    </Container>
  );
}
