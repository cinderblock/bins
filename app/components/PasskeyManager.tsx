/**
 * Register and manage the group's admin passkeys. Lives at /admin/passkey
 * (the URL to open on a new phone) and on the admin page.
 */
import { Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFingerprint, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { relativeTime } from "~/lib/format";
import {
  type PasskeyRow,
  defaultPasskeyLabel,
  listPasskeys,
  passkeysSupported,
  registerPasskey,
  removePasskey,
} from "~/lib/passkeys";

export function PasskeyManager({ adminPassword }: { adminPassword: string }) {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [label, setLabel] = useState(defaultPasskeyLabel());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await listPasskeys(adminPassword));
    } catch {
      setRows([]);
    }
  }, [adminPassword]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function register() {
    setBusy(true);
    try {
      setRows(await registerPasskey(adminPassword, label.trim() || "Passkey"));
      notifications.show({
        message: "Passkey saved. Use it to unlock admin from now on.",
        color: "green",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/abort|cancel|NotAllowedError/i.test(message))
        notifications.show({ message, color: "red" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      setRows(await removePasskey(adminPassword, id));
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <IconFingerprint size={18} />
          <Text fw={600}>Passkeys</Text>
        </Group>
        <Text size="xs" c="dimmed">
          A passkey unlocks admin on a device without the password — Face ID, a
          fingerprint, or the device's own unlock. It belongs to this group, not
          to a person. Open this page on a new phone and save one there.
        </Text>

        {rows === null ? (
          <Text size="sm" c="dimmed">
            Loading…
          </Text>
        ) : rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No passkeys yet.
          </Text>
        ) : (
          <Stack gap={4}>
            {rows.map((row) => (
              <Group key={row.id} justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" truncate>
                    {row.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    added {relativeTime(row.createdAt)}
                    {row.lastUsedAt
                      ? ` · last used ${relativeTime(row.lastUsedAt)}`
                      : " · never used"}
                  </Text>
                </div>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  disabled={busy}
                  onClick={() => void remove(row.id)}
                >
                  Remove
                </Button>
              </Group>
            ))}
          </Stack>
        )}

        {passkeysSupported() ? (
          <Group align="flex-end" gap="sm">
            <TextInput
              label="Name this passkey"
              placeholder="e.g. Cameron's iPhone"
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              leftSection={<IconFingerprint size={16} />}
              loading={busy}
              onClick={() => void register()}
            >
              Save a passkey on this device
            </Button>
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            This browser can't make passkeys. Open this page in the phone's own
            browser, or on a laptop with a fingerprint or face unlock.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
