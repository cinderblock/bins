/**
 * Pick a box size from the group's definitions — big tappable cards with
 * the size's icon and name, because on a phone at a shelf a dropdown is two
 * taps and a scroll for a choice of three.
 *
 * Only ever offers DEFINED sizes: the vocabulary is the admin's. The
 * hardcoded S/M/L/XL this replaced was exactly how "we don't have an XL"
 * happened.
 *
 * But an admin holding a box whose size isn't in the list shouldn't have to
 * leave and come back — so where admin is already unlocked, the row ends
 * with a "+ New size" card: name it, pick a glyph, and it is defined and
 * selected on the spot. Real dimensions stay in the admin manager, where
 * there is room to be careful about them; this is for getting the vocabulary
 * right while the box is still in front of you.
 */
import {
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { BoxSizeState } from "@shared/reducer";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { apiJson } from "~/lib/api";
import { formatDimensions } from "~/lib/boxSizes";
import { SIZE_ICONS, SizeIcon, type SizeIconKey } from "~/lib/sizeIcons";
import { syncNow } from "~/lib/sync";

export function SizePicker({
  sizes,
  value,
  onChange,
  label = "Size",
  adminPassword = null,
}: {
  sizes: BoxSizeState[];
  value: string | null;
  onChange: (sizeId: string | null) => void;
  label?: string;
  /**
   * Admin, unlocked on this device. Sizes are server-authored — the group's
   * vocabulary is not something any member edits — so without this the
   * picker can only offer what already exists.
   */
  adminPassword?: string | null;
}) {
  const canCreate = typeof adminPassword === "string";
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<SizeIconKey>("box");
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || !adminPassword) return;
    // Already defined under that name? Select it rather than making a second
    // one — a vocabulary of near-duplicates is worse than a missing entry.
    const existing = sizes.find(
      (s) => s.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      onChange(existing.id);
      setComposing(false);
      setName("");
      return;
    }
    setBusy(true);
    try {
      const { sizeId } = await apiJson<{ sizeId: string }>(
        "/api/admin/sizes/upsert",
        {
          method: "POST",
          body: JSON.stringify({ adminPassword, name: trimmed, icon }),
        },
      );
      // The definition reaches this device by ordinary pull and the picker
      // reads the replica, so wait for the sync before selecting it.
      await syncNow();
      onChange(sizeId);
      setName("");
      setComposing(false);
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Text size="sm" fw={500} mb={4}>
        {label}
      </Text>
      {sizes.length === 0 && !canCreate ? (
        <Text size="sm" c="dimmed">
          No sizes defined yet — an admin adds them under Admin › Box sizes.
        </Text>
      ) : (
        <Group gap="xs" align="flex-start">
          {sizes.map((size) => {
            const selected = size.id === value;
            const dims = formatDimensions(size);
            return (
              <UnstyledButton
                key={size.id}
                // Tapping the chosen size again clears it: "no size recorded"
                // is a real answer and shouldn't need a separate control.
                onClick={() => onChange(selected ? null : size.id)}
                aria-pressed={selected}
                aria-label={size.name}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 84,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `2px solid ${
                    selected
                      ? "var(--mantine-primary-color-filled)"
                      : "var(--mantine-color-default-border)"
                  }`,
                  background: selected
                    ? "var(--mantine-primary-color-light)"
                    : "transparent",
                }}
              >
                <SizeIcon icon={size.icon} size={28} />
                <Text size="sm" fw={600}>
                  {size.name}
                </Text>
                {dims && (
                  <Text size="xs" c="dimmed">
                    {dims}
                  </Text>
                )}
              </UnstyledButton>
            );
          })}

          {canCreate && !composing && (
            <UnstyledButton
              onClick={() => setComposing(true)}
              aria-label="New size"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                minWidth: 84,
                minHeight: 78,
                padding: "10px 12px",
                borderRadius: 12,
                border: "2px dashed var(--mantine-color-default-border)",
              }}
            >
              <IconPlus size={24} />
              <Text size="sm" fw={600}>
                New size
              </Text>
            </UnstyledButton>
          )}
        </Group>
      )}

      {canCreate && composing && (
        <Paper p="sm" radius="md" withBorder mt="xs">
          <Stack gap="xs">
            <TextInput
              label="Name it"
              placeholder="e.g. Banker box"
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setName("");
                  setComposing(false);
                  return;
                }
                if (e.key !== "Enter") return;
                e.preventDefault();
                void create();
              }}
            />
            <div>
              <Text size="sm" fw={500} mb={4}>
                Glyph
              </Text>
              <Group gap={6}>
                {SIZE_ICONS.map((option) => (
                  <UnstyledButton
                    key={option.key}
                    onClick={() => setIcon(option.key)}
                    aria-label={option.label}
                    aria-pressed={icon === option.key}
                    style={{
                      padding: 6,
                      borderRadius: 8,
                      border: `2px solid ${
                        icon === option.key
                          ? "var(--mantine-primary-color-filled)"
                          : "transparent"
                      }`,
                    }}
                  >
                    <SizeIcon icon={option.key} size={26} />
                  </UnstyledButton>
                ))}
              </Group>
            </div>
            <Text size="xs" c="dimmed">
              Real dimensions are optional, and live under Admin › Box sizes.
            </Text>
            <Group gap="xs" grow>
              <UnstyledButton
                onClick={() => void create()}
                disabled={!name.trim() || busy}
                style={{
                  textAlign: "center",
                  padding: "10px 14px",
                  borderRadius: 8,
                  fontWeight: 600,
                  opacity: name.trim() && !busy ? 1 : 0.5,
                  background: "var(--mantine-primary-color-filled)",
                  color: "var(--mantine-color-white)",
                }}
              >
                {busy ? "Adding…" : "Add size"}
              </UnstyledButton>
              <UnstyledButton
                onClick={() => {
                  setName("");
                  setComposing(false);
                }}
                style={{ textAlign: "center", padding: "10px 14px" }}
              >
                <Text size="sm" c="dimmed">
                  Cancel
                </Text>
              </UnstyledButton>
            </Group>
          </Stack>
        </Paper>
      )}
    </div>
  );
}
