/**
 * Label preview + print.
 *
 * Preview first, always. Printing commits physical stock, and generated art
 * costs real money per image — approving something you have not seen is how
 * both get wasted. The preview is the SAME render the printer receives, not an
 * approximation, so what you approve is what comes out.
 */
import {
  Button,
  Center,
  Group,
  Image,
  Loader,
  NumberInput,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPrinter } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { apiFetch, apiJson } from "~/lib/api";

export function LabelPrintSheet({
  binId,
  adminPassword,
  artAvailable,
  opened,
  onClose,
}: {
  binId: number;
  adminPassword: string;
  artAvailable: boolean;
  opened: boolean;
  onClose: () => void;
}) {
  const [art, setArt] = useState(false);
  const [copies, setCopies] = useState<number | string>(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  // Re-render whenever an option changes, so the preview never lags the
  // settings it claims to show.
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    apiFetch("/api/admin/bins/label/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminPassword, binId, art }),
    })
      .then((res) => res.blob())
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPreview(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      // Revoke on the way out or every preview leaks a blob for the life of
      // the page.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [opened, binId, adminPassword, art]);

  async function print() {
    setPrinting(true);
    try {
      const result = await apiJson<{ printed: number; title: string }>(
        "/api/admin/bins/label",
        {
          method: "POST",
          body: JSON.stringify({
            adminPassword,
            binId,
            art,
            copies: Math.max(1, Math.min(Number(copies) || 1, 20)),
          }),
        },
      );
      notifications.show({
        message: `Printing ${result.printed} label${result.printed === 1 ? "" : "s"} for "${result.title}"`,
        color: "green",
      });
      onClose();
    } catch (err) {
      // The printer's own words — "out of paper" beats "print failed".
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setPrinting(false);
    }
  }

  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title="Print label">
      <Stack>
        <Center mih={220}>
          {loading ? (
            <Loader />
          ) : error ? (
            <Text c="red" size="sm" ta="center">
              {error}
            </Text>
          ) : preview ? (
            // Contained, not cropped: a preview that hides an edge is exactly
            // where a layout bug would hide too.
            <Image src={preview} alt="Label preview" fit="contain" mah={320} />
          ) : null}
        </Center>

        {artAvailable && (
          <Switch
            checked={art}
            onChange={(e) => setArt(e.currentTarget.checked)}
            label="Add generated artwork"
            description="Costs a per-image fee. The same box reuses its picture rather than paying twice."
          />
        )}

        <Group align="flex-end">
          <NumberInput
            label="Copies"
            min={1}
            max={20}
            value={copies}
            onChange={setCopies}
            w={110}
          />
          <Button
            flex={1}
            size="md"
            loading={printing}
            disabled={!preview || loading}
            leftSection={<IconPrinter size={18} />}
            onClick={() => void print()}
          >
            Print
          </Button>
        </Group>
      </Stack>
    </ResponsiveSheet>
  );
}
