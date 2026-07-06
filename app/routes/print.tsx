/**
 * QR sticker sheet: batch-allocate unclaimed bins for this group (server
 * assigns global short IDs), render a printable grid of QR codes. Fresh
 * stickers are claimable offline because the allocations sync into every
 * member's replica as ops.
 */
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconPrinter } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { renderSVG } from "uqr";
import { apiJson } from "~/lib/api";
import { syncNow } from "~/lib/sync";

const printCss = `
@media print {
  body * { visibility: hidden; }
  #sticker-sheet, #sticker-sheet * { visibility: visible; }
  #sticker-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  @page { margin: 10mm; }
}
`;

export default function Print() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [count, setCount] = useState<number | string>(20);
  const [busy, setBusy] = useState(false);

  const ids = (params.get("ids") ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);

  async function allocate() {
    setBusy(true);
    try {
      const response = await apiJson<{ binIds: number[] }>(
        "/api/bins/allocate",
        {
          method: "POST",
          body: JSON.stringify({ count: Number(count) || 20 }),
        },
      );
      setParams({ ids: response.binIds.join(",") }, { replace: true });
      // Pull the new unclaimed bins into the local replica right away.
      void syncNow();
    } catch (err) {
      notifications.show({
        message: `Allocation needs the server: ${err instanceof Error ? err.message : err}`,
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack p="md" pt="max(var(--mantine-spacing-md), env(safe-area-inset-top))">
      <style>{printCss}</style>
      <Group gap="sm" className="no-print">
        <ActionIcon
          variant="default"
          size="xl"
          radius="xl"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <IconArrowLeft />
        </ActionIcon>
        <Title order={3}>Sticker sheet</Title>
      </Group>

      <Paper p="md" radius="lg" withBorder>
        <Group align="flex-end" gap="sm">
          <NumberInput
            label="New stickers"
            min={1}
            max={200}
            value={count}
            onChange={setCount}
            style={{ flex: 1 }}
          />
          <Button onClick={() => void allocate()} loading={busy}>
            Allocate
          </Button>
          {ids.length > 0 && (
            <Button
              variant="default"
              leftSection={<IconPrinter size={16} />}
              onClick={() => window.print()}
            >
              Print
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Allocating reserves bin numbers for your group; stick them on boxes
          and scan to claim (works offline once synced).
        </Text>
      </Paper>

      {ids.length > 0 && (
        <div
          id="sticker-sheet"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 8,
          }}
        >
          {ids.map((id) => {
            const url = `${window.location.origin}/${id}`;
            return (
              <div
                key={id}
                style={{
                  border: "1px dashed #999",
                  borderRadius: 8,
                  padding: 8,
                  textAlign: "center",
                  background: "#fff",
                  color: "#000",
                  breakInside: "avoid",
                }}
              >
                <div
                  style={{ width: "100%" }}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: uqr generates the SVG locally
                  dangerouslySetInnerHTML={{
                    __html: renderSVG(url, { border: 1 }),
                  }}
                />
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  #{id}
                </div>
                <div style={{ fontSize: 9, color: "#555" }}>{url}</div>
              </div>
            );
          })}
        </div>
      )}
    </Stack>
  );
}
