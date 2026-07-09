/**
 * Admin page (member-only route, linked from Settings): group config,
 * landing branding, code/password rotation, sticker import for pre-existing
 * printed labels, and device revocation. The admin password rides EVERY
 * request (no admin sessions); it's remembered per device (lib/admin.ts) so an
 * admin unlocks once and can re-lock from the header.
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconLock,
  IconPrinter,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { forgetAdmin, rememberAdmin, useAdminPassword } from "~/lib/admin";
import { apiJson } from "~/lib/api";
import { relativeTime } from "~/lib/format";
import { rememberAccessCode } from "~/lib/invite";
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

type IntegrationRow = {
  id: string;
  label: string;
  scope: "read" | "write";
  tokenPrefix: string | null;
  allowedOrigins: string[];
  lastSeenAt: number | null;
  createdAt: number;
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
  useDocumentTitle("Admin · bins");
  const navigate = useNavigate();
  // Admin unlock is remembered per device (lib/admin.ts). `password` is the
  // working password (typed or auto-loaded from the remembered value).
  const remembered = useAdminPassword();
  const [autoTried, setAutoTried] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const [config, setConfig] = useState<Config | null>(null);
  const [newAccessCode, setNewAccessCode] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [importText, setImportText] = useState("");
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newScope, setNewScope] = useState<"read" | "write">("read");
  const [newOrigins, setNewOrigins] = useState("");
  /** The just-minted token, shown once until the operator dismisses it. */
  const [freshToken, setFreshToken] = useState<string | null>(null);

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

  async function refreshIntegrations(pw: string) {
    const res = await apiJson<{ integrations: IntegrationRow[] }>(
      "/api/admin/integrations",
      { method: "POST", body: JSON.stringify({ adminPassword: pw }) },
    );
    setIntegrations(res.integrations);
  }

  async function doUnlock(pw: string) {
    const res = await apiJson<{ config: Config }>("/api/admin/verify", {
      method: "POST",
      body: JSON.stringify({ adminPassword: pw }),
    });
    setConfig(res.config);
    await refreshDeviceList(pw);
    await refreshIntegrations(pw);
    setUnlocked(true);
  }

  async function unlock() {
    setBusy(true);
    try {
      await doUnlock(password);
      await rememberAdmin(password);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function lock() {
    void forgetAdmin();
    setUnlocked(false);
    setPassword("");
    setConfig(null);
  }

  // Auto-unlock once from the password remembered on this device; if it no
  // longer verifies (rotated elsewhere), forget it and fall back to the prompt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the remembered value resolves
  useEffect(() => {
    if (autoTried || remembered === undefined) return;
    setAutoTried(true);
    if (typeof remembered === "string") {
      setPassword(remembered);
      void doUnlock(remembered).catch(() => forgetAdmin());
    }
  }, [remembered, autoTried]);

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
      if (newAdminPassword) {
        setPassword(newAdminPassword);
        await rememberAdmin(newAdminPassword);
      }
      // Cache the rotated code so this device's invite link stays current.
      if (newAccessCode) await rememberAccessCode(newAccessCode);
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

  async function createIntegration() {
    const origins = newOrigins
      .split(/[\s,]+/)
      .map((o) => o.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      const res = await apiJson<{ token: string }>(
        "/api/admin/integrations/create",
        {
          method: "POST",
          body: JSON.stringify({
            adminPassword: password,
            label: newLabel.trim(),
            scope: newScope,
            ...(origins.length ? { allowedOrigins: origins } : {}),
          }),
        },
      );
      setFreshToken(res.token);
      setNewLabel("");
      setNewOrigins("");
      setNewScope("read");
      await refreshIntegrations(password);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function revokeIntegration(row: IntegrationRow) {
    setBusy(true);
    try {
      await apiJson("/api/admin/integrations/revoke", {
        method: "POST",
        body: JSON.stringify({
          adminPassword: password,
          integrationId: row.id,
        }),
      });
      await refreshIntegrations(password);
      notifications.show({ message: `Revoked ${row.label}`, color: "green" });
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
      <Group justify="space-between">
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
        {unlocked && (
          <Button
            size="xs"
            variant="light"
            color="yellow"
            leftSection={<IconLock size={12} />}
            onClick={lock}
          >
            Lock
          </Button>
        )}
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
              <Text fw={600}>Sticker sheets</Text>
              <Text size="xs" c="dimmed">
                Allocate new bin numbers and print a QR sheet to stick on boxes.
              </Text>
              <Button
                leftSection={<IconPrinter size={16} />}
                onClick={() => navigate("/print")}
              >
                Open sticker sheets
              </Button>
            </Stack>
          </Paper>

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
              <Text fw={600}>Integrations / API tokens</Text>
              <Text size="xs" c="dimmed">
                Mint a token for another app to read (and, with write scope,
                author changes via the API). Read-only tokens are safe to embed
                in a front-end; keep write tokens server-side.
              </Text>

              {freshToken && (
                <Alert color="green" variant="light" title="New token">
                  <Stack gap="xs">
                    <Text size="xs">
                      Copy it now — it's shown only once and never stored in
                      full.
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                      <Code
                        style={{
                          overflowWrap: "anywhere",
                          flex: 1,
                          fontSize: 12,
                        }}
                      >
                        {freshToken}
                      </Code>
                      <CopyButton value={freshToken}>
                        {({ copied, copy }) => (
                          <ActionIcon
                            variant="light"
                            color={copied ? "teal" : "gray"}
                            onClick={copy}
                            aria-label="Copy token"
                          >
                            {copied ? (
                              <IconCheck size={16} />
                            ) : (
                              <IconCopy size={16} />
                            )}
                          </ActionIcon>
                        )}
                      </CopyButton>
                    </Group>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => setFreshToken(null)}
                    >
                      Done
                    </Button>
                  </Stack>
                </Alert>
              )}

              <TextInput
                label="Label"
                placeholder="Warehouse dashboard"
                value={newLabel}
                onChange={(e) => setNewLabel(e.currentTarget.value)}
              />
              <Select
                label="Scope"
                data={[
                  { value: "read", label: "Read only" },
                  { value: "write", label: "Read + write" },
                ]}
                value={newScope}
                onChange={(v) => setNewScope(v === "write" ? "write" : "read")}
                allowDeselect={false}
              />
              <TextInput
                label="Allowed browser origins"
                description="Optional, for tokens called from a browser. Space/comma separated, e.g. https://app.example.com."
                placeholder="https://app.example.com"
                value={newOrigins}
                onChange={(e) => setNewOrigins(e.currentTarget.value)}
              />
              <Button
                onClick={() => void createIntegration()}
                loading={busy}
                disabled={!newLabel.trim()}
              >
                Create token
              </Button>

              {integrations.length > 0 && (
                <Table>
                  <Table.Tbody>
                    {integrations.map((row) => (
                      <Table.Tr key={row.id}>
                        <Table.Td>
                          {row.label}
                          <Text size="xs" c="dimmed" ff="monospace">
                            {row.tokenPrefix
                              ? `bins_${row.tokenPrefix}_…`
                              : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            size="sm"
                            variant="light"
                            color={row.scope === "write" ? "orange" : "blue"}
                          >
                            {row.scope}
                          </Badge>
                        </Table.Td>
                        <Table.Td c="dimmed">
                          {row.lastSeenAt
                            ? relativeTime(row.lastSeenAt)
                            : "never used"}
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => void revokeIntegration(row)}
                            aria-label={`Revoke ${row.label}`}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
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
            Admin stays unlocked on this device until you Lock it (or the
            password is rotated elsewhere). The password is kept only in this
            device's local storage, never sent anywhere without your action.
          </Alert>
        </>
      )}
    </Stack>
  );
}
