/**
 * "/admin/passkey" — the URL to open on a new device: unlock admin once (the
 * password, or a passkey from another device), then save a passkey here so
 * the password is never typed on this device again.
 */
import { ActionIcon, Group, Paper, Stack, Title } from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import { IconArrowLeft } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { AdminUnlock } from "~/components/AdminUnlock";
import { PasskeyManager } from "~/components/PasskeyManager";
import { useAdminPassword } from "~/lib/admin";

export default function AdminPasskey() {
  useDocumentTitle("Passkeys · bins");
  const navigate = useNavigate();
  const remembered = useAdminPassword();
  if (remembered === undefined) return null;

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), calc(env(safe-area-inset-top) + var(--bins-banner-h, 0px)))"
      maw={520}
      mx="auto"
    >
      <Group gap="sm">
        <ActionIcon
          variant="default"
          size="xl"
          radius="xl"
          onClick={() =>
            (window.history.state?.idx ?? 0) > 0
              ? navigate(-1)
              : navigate("/admin")
          }
          aria-label="Back"
        >
          <IconArrowLeft />
        </ActionIcon>
        <Title order={3}>Admin passkeys</Title>
      </Group>
      {remembered === null ? (
        <Paper p="md" radius="lg" withBorder>
          <AdminUnlock
            description="Unlock admin once on this device — with the password, or a passkey saved on another device — then save a passkey here."
            onUnlocked={() => undefined}
          />
        </Paper>
      ) : (
        <PasskeyManager adminPassword={remembered} />
      )}
    </Stack>
  );
}
