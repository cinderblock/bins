/**
 * Pick a box size from the group's definitions — big tappable cards with
 * the size's icon and name, because on a phone at a shelf a dropdown is two
 * taps and a scroll for a choice of three.
 *
 * Only ever offers DEFINED sizes: the vocabulary is the admin's. A group with
 * none defined yet gets a nudge, not a fallback list — the hardcoded S/M/L/XL
 * this replaced was exactly how "we don't have an XL" happened.
 */
import { Group, Text, UnstyledButton } from "@mantine/core";
import type { BoxSizeState } from "@shared/reducer";
import { formatDimensions } from "~/lib/boxSizes";
import { SizeIcon } from "~/lib/sizeIcons";

export function SizePicker({
  sizes,
  value,
  onChange,
  label = "Size",
}: {
  sizes: BoxSizeState[];
  value: string | null;
  onChange: (sizeId: string | null) => void;
  label?: string;
}) {
  return (
    <div>
      <Text size="sm" fw={500} mb={4}>
        {label}
      </Text>
      {sizes.length === 0 ? (
        <Text size="sm" c="dimmed">
          No sizes defined yet — an admin adds them under Admin › Box sizes.
        </Text>
      ) : (
        <Group gap="xs">
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
        </Group>
      )}
    </div>
  );
}
