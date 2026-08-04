/**
 * Signed-out landing for non-sticker URLs. Scanning a sticker IS the login,
 * so this is mostly branding — but it is also where someone lands who typed a
 * box URL off a sticker without its code, or followed a link from a friend,
 * and a page that only shows a logo reads as "this app is broken".
 *
 * So: when the URL names a box, say which box and what opens it; and always
 * offer the access-code route (user decision 2026-08-04, superseding the
 * earlier "no entry form on the landing" call). The form itself still lives
 * only at /join — this links there and hands back the page to return to.
 *
 * Branding is served by the API (the repo stays tenant-agnostic); a fresh
 * database redirects to first-boot /setup.
 */
import { Anchor, Paper, Stack, Text, Title } from "@mantine/core";
import { IconQrcode } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

type Branding = { title: string; subtitle: string };

const FALLBACK: Branding = {
  title: "Inventory Management System",
  subtitle: "Scan a Box to Start",
};

export function Landing({ binId }: { binId?: number }) {
  const navigate = useNavigate();
  const location = useLocation();
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
      {binId != null && (
        <Paper p="md" radius="lg" withBorder maw={420} w="100%">
          <Stack gap={6}>
            <Text fw={600}>Box #{binId}</Text>
            <Text size="sm" c="dimmed">
              This device hasn’t joined yet. Scan the QR code on the box —
              that’s what signs you in — and it opens straight to this page.
            </Text>
          </Stack>
        </Paper>
      )}
      <Anchor
        component={Link}
        to="/join"
        state={{ next: `${location.pathname}${location.search}` }}
        c="dimmed"
        size="sm"
      >
        I have an access code
      </Anchor>
    </Stack>
  );
}
