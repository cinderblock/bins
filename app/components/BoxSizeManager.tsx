/**
 * Admin management of box-size definitions.
 *
 * Sizes replaced a hardcoded S/M/L/XL list, so this is where the vocabulary
 * actually lives. Admin-only and server-authored (like sticker allocation):
 * members pick from the list, they don't extend it.
 *
 * Dimensions are optional and entered in inches or cm, stored as canonical
 * millimetres — the same split weight already makes with grams.
 */
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { BoxSizeState } from "@shared/reducer";
import { IconArchive, IconPencil, IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "~/lib/api";
import { formatDimensions } from "~/lib/boxSizes";
import { syncNow } from "~/lib/sync";

type Unit = "in" | "cm";
const MM_PER_INCH = 25.4;

function toMm(value: number | null, unit: Unit): number | null {
  if (value == null || value <= 0) return null;
  return Math.round(unit === "in" ? value * MM_PER_INCH : value * 10);
}
function fromMm(mm: number | null, unit: Unit): number | "" {
  if (mm == null) return "";
  return unit === "in"
    ? Math.round((mm / MM_PER_INCH) * 10) / 10
    : Math.round(mm / 10);
}

type Draft = {
  sizeId?: string;
  name: string;
  length: number | "";
  width: number | "";
  height: number | "";
};

const EMPTY: Draft = { name: "", length: "", width: "", height: "" };

export function BoxSizeManager({ adminPassword }: { adminPassword: string }) {
  const [sizes, setSizes] = useState<BoxSizeState[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [unit, setUnit] = useState<Unit>("in");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await apiJson<{ sizes: BoxSizeState[] }>("/api/admin/sizes", {
      method: "POST",
      body: JSON.stringify({ adminPassword }),
    });
    setSizes(res.sizes);
  }, [adminPassword]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  async function save() {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await apiJson("/api/admin/sizes/upsert", {
        method: "POST",
        body: JSON.stringify({
          adminPassword,
          sizeId: draft.sizeId,
          name: draft.name.trim(),
          lengthMm: toMm(draft.length === "" ? null : draft.length, unit),
          widthMm: toMm(draft.width === "" ? null : draft.width, unit),
          heightMm: toMm(draft.height === "" ? null : draft.height, unit),
        }),
      });
      setDraft(EMPTY);
      await refresh();
      // The definition reaches this device's replica by ordinary pull, which
      // is what the box picker reads — nudge it so the new size is usable now.
      await syncNow();
    } catch (err) {
      notifications.show({ message: `Could not save: ${err}`, color: "red" });
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(size: BoxSizeState, archived: boolean) {
    setBusy(true);
    try {
      await apiJson("/api/admin/sizes/archive", {
        method: "POST",
        body: JSON.stringify({ adminPassword, sizeId: size.id, archived }),
      });
      await refresh();
      await syncNow();
    } catch (err) {
      notifications.show({
        message: `Could not archive: ${err}`,
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="sm">
        <Text fw={600}>Box sizes</Text>
        <Text size="xs" c="dimmed">
          The sizes everyone picks from. Dimensions are optional — a name on its
          own is fine. Archiving keeps existing boxes' size intact and just
          removes it from the picker.
        </Text>

        <Stack gap="xs">
          {sizes.map((size) => {
            const dims = formatDimensions(size, unit);
            return (
              <Group key={size.id} justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text
                    size="sm"
                    td={size.archived ? "line-through" : undefined}
                  >
                    {size.name}
                  </Text>
                  {dims && (
                    <Text size="xs" c="dimmed">
                      {dims}
                    </Text>
                  )}
                </div>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Edit ${size.name}`}
                    onClick={() =>
                      setDraft({
                        sizeId: size.id,
                        name: size.name,
                        length: fromMm(size.lengthMm, unit),
                        width: fromMm(size.widthMm, unit),
                        height: fromMm(size.heightMm, unit),
                      })
                    }
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color={size.archived ? "green" : "red"}
                    aria-label={`${size.archived ? "Restore" : "Archive"} ${size.name}`}
                    onClick={() => void setArchived(size, !size.archived)}
                  >
                    <IconArchive size={16} />
                  </ActionIcon>
                </Group>
              </Group>
            );
          })}
          {sizes.length === 0 && (
            <Text size="sm" c="dimmed">
              No sizes defined yet.
            </Text>
          )}
        </Stack>

        <SegmentedControl
          size="xs"
          value={unit}
          onChange={(v) => setUnit(v as Unit)}
          data={[
            { value: "in", label: "inches" },
            { value: "cm", label: "cm" },
          ]}
        />
        <TextInput
          label={draft.sizeId ? "Edit size" : "New size"}
          placeholder="e.g. Banker box"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
        />
        <Group grow>
          <NumberInput
            label={`Length (${unit})`}
            min={0}
            value={draft.length}
            onChange={(v) =>
              setDraft({ ...draft, length: v === "" ? "" : Number(v) })
            }
          />
          <NumberInput
            label={`Width (${unit})`}
            min={0}
            value={draft.width}
            onChange={(v) =>
              setDraft({ ...draft, width: v === "" ? "" : Number(v) })
            }
          />
          <NumberInput
            label={`Height (${unit})`}
            min={0}
            value={draft.height}
            onChange={(v) =>
              setDraft({ ...draft, height: v === "" ? "" : Number(v) })
            }
          />
        </Group>
        <Group>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => void save()}
            loading={busy}
            disabled={!draft.name.trim()}
          >
            {draft.sizeId ? "Save size" : "Add size"}
          </Button>
          {draft.sizeId && (
            <Button variant="default" onClick={() => setDraft(EMPTY)}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
