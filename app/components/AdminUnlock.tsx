/**
 * The one way to unlock admin on a device: the group's admin password, or —
 * once the group has any registered — a passkey. Every place that used to
 * have its own password box (the box list, the admin page, sticker codes)
 * shows this instead, so a passkey works everywhere the password did.
 */
import { Button, Divider, PasswordInput, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFingerprint } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ADMIN_VIA_PASSKEY, rememberAdmin, verifyAdmin } from "~/lib/admin";
import {
  loginWithPasskey,
  passkeyStatus,
  passkeysSupported,
} from "~/lib/passkeys";

export function AdminUnlock({
  description,
  onUnlocked,
}: {
  description?: string;
  /** The remembered value: the password, or the passkey sentinel. */
  onUnlocked: (adminPassword: string) => void | Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState(0);

  useEffect(() => {
    let cancelled = false;
    passkeyStatus()
      .then((s) => {
        if (!cancelled) setPasskeys(s.registered);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function withPassword() {
    setBusy(true);
    try {
      await verifyAdmin(password);
      await rememberAdmin(password);
      await onUnlocked(password);
      setPassword("");
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function withPasskey() {
    setBusy(true);
    try {
      await loginWithPasskey();
      await rememberAdmin(ADMIN_VIA_PASSKEY);
      await onUnlocked(ADMIN_VIA_PASSKEY);
    } catch (err) {
      // A cancelled prompt is not an error worth a red toast.
      const message = err instanceof Error ? err.message : String(err);
      if (!/abort|cancel|NotAllowedError/i.test(message))
        notifications.show({ message, color: "red" });
    } finally {
      setBusy(false);
    }
  }

  const offerPasskey = passkeys > 0 && passkeysSupported();

  return (
    <Stack gap="sm">
      {description && (
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      )}
      {offerPasskey && (
        <>
          <Button
            size="md"
            leftSection={<IconFingerprint size={18} />}
            loading={busy}
            onClick={() => void withPasskey()}
          >
            Unlock with a passkey
          </Button>
          <Divider label="or with the password" labelPosition="center" />
        </>
      )}
      <PasswordInput
        label="Admin password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && password && void withPassword()}
        autoFocus={!offerPasskey}
      />
      <Button
        variant={offerPasskey ? "default" : "filled"}
        onClick={() => void withPassword()}
        loading={busy}
        disabled={!password}
      >
        Unlock
      </Button>
    </Stack>
  );
}
