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
import { Button, Paper, Stack, Text, Title } from "@mantine/core";
import { IconQrcode } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { TOUCH_TARGET } from "~/lib/ui";

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

  // The page they were actually trying to reach, if it wasn't just "/".
  const wantedPath = location.pathname !== "/" ? location.pathname : undefined;

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
      {/* Landing on a real page (/admin, /bins, /settings…) while signed out
          used to render as plain branding, which reads as "the page is
          broken" — reported exactly that way, more than once. Name the page
          they asked for and say what's missing. */}
      {binId == null && wantedPath && (
        <Paper p="md" radius="lg" withBorder maw={420} w="100%">
          <Stack gap={6}>
            <Text fw={600}>Sign in to open {wantedPath}</Text>
            <Text size="sm" c="dimmed">
              This device hasn’t joined yet. Scan a box sticker, or enter the
              group access code below — either one brings you straight back
              here.
            </Text>
          </Stack>
        </Paper>
      )}
      {/* A real button, not the dimmed link this used to be. That link was
          reported three times as "isn't a button" / "not clickable": it was a
          working <a>, but 14px of grey text is neither a visible affordance
          nor a thumb-sized target. */}
      <Button
        component={Link}
        to="/join"
        state={{ next: `${location.pathname}${location.search}` }}
        size="lg"
        variant="light"
        maw={420}
        w="100%"
        styles={{ root: { minHeight: TOUCH_TARGET } }}
      >
        Enter access code
      </Button>
    </Stack>
  );
}
