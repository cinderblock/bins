/**
 * Allocate bin IDs + sticker secrets for a group (server assigns the global
 * short IDs) and either render a printable QR grid or export the raw id/code/
 * URL rows (TSV) for operators who print their own precise sticker format.
 * Fresh stickers are claimable offline because the allocations sync into every
 * member's replica as ops.
 */
import {
  ActionIcon,
  Button,
  Code,
  CopyButton,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconPrinter,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { renderSVG } from "uqr";
import { rememberAdmin, useAdminPassword, verifyAdmin } from "~/lib/admin";
import { apiJson } from "~/lib/api";
import { db } from "~/lib/db";
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
  const [idDigits, setIdDigits] = useState<number | string>(4);
  const [busy, setBusy] = useState(false);

  // Sticker sheets are admin-only: allocation hands out the global bin-ID
  // sequence. The admin unlock is remembered per device (lib/admin.ts); on a
  // direct load with no remembered password we prompt for it here.
  const remembered = useAdminPassword();
  const unlocked = typeof remembered === "string";
  const adminPassword = remembered ?? "";
  const [unlockPw, setUnlockPw] = useState("");

  async function unlock() {
    setBusy(true);
    try {
      await verifyAdmin(unlockPw);
      await rememberAdmin(unlockPw);
      setUnlockPw("");
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  const ids = (params.get("ids") ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);

  // Sticker secrets come from the replica (they ride the bin.allocate ops),
  // which is also what lets old sheets re-render long after allocation.
  const codeById = useLiveQuery(
    async () =>
      new Map(
        (await db.bins.where("id").anyOf(ids).toArray()).map((bin) => [
          bin.id,
          bin.secretCode,
        ]),
      ),
    [params.get("ids")],
    new Map<number, string | null>(),
  );

  async function allocate() {
    setBusy(true);
    try {
      const response = await apiJson<{ bins: { id: number; code: string }[] }>(
        "/api/admin/bins/allocate",
        {
          method: "POST",
          body: JSON.stringify({
            adminPassword,
            count: Number(count) || 20,
          }),
        },
      );
      setParams(
        { ids: response.bins.map((bin) => bin.id).join(",") },
        { replace: true },
      );
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

  // Rows for the "print your own" export: only bins whose code has synced in.
  const pad = Math.max(1, Number(idDigits) || 1);
  const exportRows = ids
    .map((id) => ({ id, code: codeById.get(id) ?? null }))
    .filter((r): r is { id: number; code: string } => r.code != null);
  const exportText = [
    "id\tcode\turl",
    ...exportRows.map((r) => {
      // Upper-cased so the whole URL stays in QR alphanumeric mode = tighter code.
      const url = `${window.location.origin}/${r.id}#${r.code}`.toUpperCase();
      return `${String(r.id).padStart(pad, "0")}\t${r.code}\t${url}`;
    }),
  ].join("\n");

  if (!unlocked) {
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
          <Title order={3}>Sticker sheet</Title>
        </Group>
        <Paper p="md" radius="lg" withBorder>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Printing sticker sheets allocates new bin numbers, so it needs the
              admin password (set during first-boot setup).
            </Text>
            <PasswordInput
              label="Admin password"
              value={unlockPw}
              onChange={(e) => setUnlockPw(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && unlockPw && void unlock()}
              autoFocus
            />
            <Button
              onClick={() => void unlock()}
              loading={busy}
              disabled={!unlockPw}
            >
              Unlock
            </Button>
          </Stack>
        </Paper>
      </Stack>
    );
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

      {exportRows.length > 0 && (
        <Paper className="no-print" p="md" radius="lg" withBorder>
          <Stack gap="sm">
            <Text fw={600}>Export for your own sticker format</Text>
            <Group align="flex-end" gap="sm">
              <NumberInput
                label="ID digits"
                min={1}
                max={9}
                value={idDigits}
                onChange={setIdDigits}
                w={110}
              />
              <CopyButton value={exportText}>
                {({ copied, copy }) => (
                  <Button
                    variant={copied ? "light" : "default"}
                    color={copied ? "green" : undefined}
                    leftSection={
                      copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                    }
                    onClick={copy}
                  >
                    {copied ? "Copied" : "Copy ID + code + URL"}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Code block style={{ whiteSpace: "pre", overflowX: "auto" }}>
              {exportText}
            </Code>
            <Text size="xs" c="dimmed">
              Tab-separated for pasting into spreadsheet columns. The padded ID
              is the big human number, the code is the sticker secret, and the
              URL is upper-cased so its QR encodes tighter.
            </Text>
          </Stack>
        </Paper>
      )}

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
            const code = codeById.get(id);
            // No QR without the secret — a bare /{id} sticker grants nothing.
            // Fragment, not query string: the code never reaches server logs.
            const url = code ? `${window.location.origin}/${id}#${code}` : null;
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
                {url ? (
                  <div
                    style={{ width: "100%" }}
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: uqr generates the SVG locally
                    dangerouslySetInnerHTML={{
                      __html: renderSVG(url, { border: 1 }),
                    }}
                  />
                ) : (
                  <div style={{ padding: "2em 0", color: "#888" }}>
                    waiting for sync…
                  </div>
                )}
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  #{id}
                </div>
                {/* Human fallback: type the number + this code to join. */}
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    letterSpacing: 2,
                  }}
                >
                  {code ?? ""}
                </div>
                {url && <div style={{ fontSize: 9, color: "#555" }}>{url}</div>}
              </div>
            );
          })}
        </div>
      )}
    </Stack>
  );
}
