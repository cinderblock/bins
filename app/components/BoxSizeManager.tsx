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
  Button,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { BoxSizeState } from "@shared/reducer";
import { IconArchive, IconPencil, IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "~/lib/api";
import { formatDimensions } from "~/lib/boxSizes";
import { SIZE_ICONS, SizeIcon } from "~/lib/sizeIcons";
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
  icon: string | null;
  length: number | "";
  width: number | "";
  height: number | "";
};

const EMPTY: Draft = {
  name: "",
  icon: null,
  length: "",
  width: "",
  height: "",
};

/**
 * A starting vocabulary for a group with none: three common sizes with
 * typical dimensions, all editable afterwards. Offered rather than seeded
 * automatically, because a group that uses milk crates should not wake up
 * owning a banker's box.
 */
const STARTER_SIZES: {
  name: string;
  icon: string;
  inches: [number, number, number];
}[] = [
  { name: "S", icon: "pencil-case", inches: [9, 4, 2.5] },
  { name: "M", icon: "paper-stack", inches: [11, 8.5, 4.5] },
  { name: "L", icon: "bankers-box", inches: [15, 12, 10] },
];

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
          icon: draft.icon,
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

  async function seedStarters() {
    setBusy(true);
    try {
      for (const starter of STARTER_SIZES) {
        const [l, w, h] = starter.inches;
        await apiJson("/api/admin/sizes/upsert", {
          method: "POST",
          body: JSON.stringify({
            adminPassword,
            name: starter.name,
            icon: starter.icon,
            lengthMm: toMm(l, "in"),
            widthMm: toMm(w, "in"),
            heightMm: toMm(h, "in"),
          }),
        });
      }
      await refresh();
      await syncNow();
    } catch (err) {
      notifications.show({ message: `Could not add: ${err}`, color: "red" });
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
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <SizeIcon icon={size.icon} size={24} />
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
                </Group>
                {/* Labelled, not icon-only: an unlabelled pencil next to an
                    unlabelled box means guessing, and a hover tooltip is
                    invisible on a touch screen. */}
                <Group gap="xs" wrap="nowrap">
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    leftSection={<IconPencil size={14} />}
                    onClick={() =>
                      setDraft({
                        sizeId: size.id,
                        name: size.name,
                        icon: size.icon,
                        length: fromMm(size.lengthMm, unit),
                        width: fromMm(size.widthMm, unit),
                        height: fromMm(size.heightMm, unit),
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color={size.archived ? "green" : "red"}
                    leftSection={<IconArchive size={14} />}
                    onClick={() => void setArchived(size, !size.archived)}
                  >
                    {size.archived ? "Restore" : "Archive"}
                  </Button>
                </Group>
              </Group>
            );
          })}
          {sizes.length === 0 && (
            <Group gap="sm">
              <Text size="sm" c="dimmed">
                No sizes defined yet.
              </Text>
              <Button
                size="compact-sm"
                variant="light"
                loading={busy}
                onClick={() => void seedStarters()}
              >
                Start with S / M / L
              </Button>
            </Group>
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
        <div>
          <Text size="sm" fw={500} mb={4}>
            Icon
          </Text>
          <Group gap={6}>
            {SIZE_ICONS.map((option) => {
              const selected = draft.icon === option.key;
              return (
                <UnstyledButton
                  key={option.key}
                  onClick={() =>
                    setDraft({ ...draft, icon: selected ? null : option.key })
                  }
                  aria-pressed={selected}
                  aria-label={option.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    width: 64,
                    padding: "6px 0",
                    borderRadius: 8,
                    border: `2px solid ${
                      selected
                        ? "var(--mantine-primary-color-filled)"
                        : "var(--mantine-color-default-border)"
                    }`,
                  }}
                >
                  <SizeIcon icon={option.key} size={24} />
                  <Text size="xs" c="dimmed" ta="center" lh={1.1}>
                    {option.label}
                  </Text>
                </UnstyledButton>
              );
            })}
          </Group>
        </div>
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
