/**
 * Signed-out landing for non-sticker URLs: pure branding, no entry form —
 * scanning a sticker IS the login. Branding is served by the API (the repo
 * stays tenant-agnostic); a fresh database redirects to first-boot /setup.
 */
import { Stack, Text, Title } from "@mantine/core";
import { IconQrcode } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

type Branding = { title: string; subtitle: string };

const FALLBACK: Branding = {
  title: "Inventory Management System",
  subtitle: "Scan a Box to Start",
};

export function Landing() {
  const navigate = useNavigate();
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/landing")
      .then((res) => res.json())
      .then((body: Branding & { needsSetup: boolean }) => {
        if (cancelled) return;
        if (body.needsSetup) navigate("/setup", { replace: true });
        else setBranding(body);
      })
      .catch(() => {
        // Offline / server unreachable — generic branding beats a blank page.
        if (!cancelled) setBranding(FALLBACK);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!branding) return null;
  return (
    <Stack
      align="center"
      justify="center"
      gap="md"
      p="xl"
      style={{ minHeight: "100dvh", textAlign: "center" }}
    >
      <IconQrcode size={72} style={{ opacity: 0.35 }} />
      <Title order={1}>{branding.title}</Title>
      <Text size="xl" c="dimmed">
        {branding.subtitle}
      </Text>
    </Stack>
  );
}
