/**
 * Admin page (member-only route, linked from Settings): group config,
 * landing branding, code/password rotation, sticker import for pre-existing
 * printed labels, and device revocation. The admin password rides EVERY
 * request (no admin sessions) and lives only in component state — reloading
 * the page locks it again.
 */
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { apiJson } from "~/lib/api";
import { relativeTime } from "~/lib/format";
import { syncNow } from "~/lib/sync";

type Config = {
  name: string;
  landingTitle: string | null;
  landingSubtitle: string | null;
};

type DeviceRow = {
  id: string;
  displayName: string;
  lastSeenAt: number | null;
  self: boolean;
};

function parseImport(text: string): { id: number; code: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, code] = line.split(/[\s,;]+/);
      return { id: Number(id), code: code ?? "" };
    });
}

export default function Admin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const [config, setConfig] = useState<Config | null>(null);
  const [newAccessCode, setNewAccessCode] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [importText, setImportText] = useState("");
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  function fail(err: unknown) {
    notifications.show({
      message: err instanceof Error ? err.message : String(err),
      color: "red",
    });
  }

  async function refreshDeviceList(pw: string) {
    const res = await apiJson<{ devices: DeviceRow[] }>("/api/admin/devices", {
      method: "POST",
      body: JSON.stringify({ adminPassword: pw }),
    });
    setDevices(res.devices);
  }

  async function unlock() {
    setBusy(true);
    try {
      const res = await apiJson<{ config: Config }>("/api/admin/verify", {
        method: "POST",
        body: JSON.stringify({ adminPassword: password }),
      });
      setConfig(res.config);
      await refreshDeviceList(password);
      setUnlocked(true);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    if (!config) return;
    setBusy(true);
    try {
      const res = await apiJson<{ config: Config }>("/api/admin/group", {
        method: "POST",
        body: JSON.stringify({
          adminPassword: password,
          name: config.name,
          landingTitle: config.landingTitle ?? "",
          landingSubtitle: config.landingSubtitle ?? "",
          ...(newAccessCode ? { newAccessCode } : {}),
          ...(newAdminPassword ? { newAdminPassword } : {}),
        }),
      });
      setConfig(res.config);
      if (newAdminPassword) setPassword(newAdminPassword);
      setNewAccessCode("");
      setNewAdminPassword("");
      notifications.show({ message: "Saved", color: "green" });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    const bins = parseImport(importText);
    const bad = bins.filter(
      (b) => !Number.isInteger(b.id) || b.id <= 0 || !b.code,
    );
    if (bins.length === 0 || bad.length > 0) {
      notifications.show({
        message:
          bad.length > 0
            ? `Unparseable line (want "id,code"): "${bad[0]?.id},${bad[0]?.code}"`
            : "Nothing to import",
        color: "red",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await apiJson<{
        imported: number;
        skipped: { id: number; reason: string }[];
      }>("/api/admin/bins/import", {
        method: "POST",
        body: JSON.stringify({ adminPassword: password, bins }),
      });
      const skippedNote =
        res.skipped.length > 0
          ? `; skipped ${res.skipped.map((s) => `#${s.id}`).join(", ")} (already exist)`
          : "";
      notifications.show({
        message: `Imported ${res.imported} bins${skippedNote}`,
        color: res.skipped.length > 0 ? "yellow" : "green",
        autoClose: 8000,
      });
      if (res.imported > 0) {
        setImportText("");
        void syncNow(); // pull the new bins into this device's replica
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: DeviceRow) {
    setBusy(true);
    try {
      await apiJson("/api/admin/devices/revoke", {
        method: "POST",
        body: JSON.stringify({ adminPassword: password, deviceId: device.id }),
      });
      await refreshDeviceList(password);
      notifications.show({
        message: `Revoked ${device.displayName}`,
        color: "green",
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), env(safe-area-inset-top))"
      maw={520}
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
        <Title order={3}>Admin</Title>
      </Group>

      {!unlocked ? (
        <Paper p="md" radius="lg" withBorder>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Group administration needs the admin password (set during
              first-boot setup).
            </Text>
            <PasswordInput
              label="Admin password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && password && void unlock()}
              autoFocus
            />
            <Button
              onClick={() => void unlock()}
              loading={busy}
              disabled={!password}
            >
              Unlock
            </Button>
          </Stack>
        </Paper>
      ) : (
        <>
          {config && (
            <Paper p="md" radius="lg" withBorder>
              <Stack gap="sm">
                <Text fw={600}>Group & landing page</Text>
                <TextInput
                  label="Group name"
                  value={config.name}
                  onChange={(e) =>
                    setConfig({ ...config, name: e.currentTarget.value })
                  }
                />
                <TextInput
                  label="Landing title"
                  placeholder={`${config.name} Inventory Management System`}
                  description="Empty = the default shown in the placeholder."
                  value={config.landingTitle ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      landingTitle: e.currentTarget.value,
                    })
                  }
                />
                <TextInput
                  label="Landing subtitle"
                  placeholder="Scan a Box to Start"
                  value={config.landingSubtitle ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      landingSubtitle: e.currentTarget.value,
                    })
                  }
                />
                <PasswordInput
                  label="New member access code"
                  description="Leave empty to keep the current one."
                  value={newAccessCode}
                  onChange={(e) => setNewAccessCode(e.currentTarget.value)}
                />
                <PasswordInput
                  label="New admin password"
                  description="Leave empty to keep the current one."
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.currentTarget.value)}
                />
                <Button onClick={() => void saveConfig()} loading={busy}>
                  Save
                </Button>
              </Stack>
            </Paper>
          )}

          <Paper p="md" radius="lg" withBorder>
            <Stack gap="sm">
              <Text fw={600}>Import existing stickers</Text>
              <Text size="xs" c="dimmed">
                One bin per line: <code>id,code</code> (e.g.{" "}
                <code>123,7HX6</code>). For stickers that were printed before
                this deploy. Future allocations continue above the highest
                imported number.
              </Text>
              <Textarea
                placeholder={"101,7HX6\n102,QK4M"}
                autosize
                minRows={4}
                maxRows={12}
                value={importText}
                onChange={(e) => setImportText(e.currentTarget.value)}
                styles={{ input: { fontFamily: "monospace" } }}
              />
              <Button
                onClick={() => void runImport()}
                loading={busy}
                disabled={!importText.trim()}
              >
                Import
              </Button>
            </Stack>
          </Paper>

          <Paper p="md" radius="lg" withBorder>
            <Stack gap="sm">
              <Text fw={600}>Devices</Text>
              <Text size="xs" c="dimmed">
                Revoking signs a device out; its unsynced work survives locally
                and flows after it signs back in (Settings).
              </Text>
              <Table>
                <Table.Tbody>
                  {devices.map((device) => (
                    <Table.Tr key={device.id}>
                      <Table.Td>
                        {device.displayName}
                        {device.self ? " (this device)" : ""}
                      </Table.Td>
                      <Table.Td c="dimmed">
                        {device.lastSeenAt
                          ? relativeTime(device.lastSeenAt)
                          : "never"}
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => void revoke(device)}
                          aria-label={`Revoke ${device.displayName}`}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          </Paper>

          <Alert color="gray" variant="light">
            The admin password is asked again after a reload — it's never stored
            on the device.
          </Alert>
        </>
      )}
    </Stack>
  );
}
