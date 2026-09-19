/**
 * How full a box is. Stored as an integer percent (shared/ops.ts) so the
 * scale can get finer later; entered as five taps, because on a phone in a
 * storage unit "about half" is the honest precision and a slider invites
 * fiddling. Member-editable directly, like weight — fullness changes with use
 * and a wrong value is self-correcting.
 */
import { Badge, Button, Group, SegmentedControl, Text } from "@mantine/core";

/** The five steps offered, as stored percents. */
export const FILL_STEPS = [0, 25, 50, 75, 100] as const;

const STEP_LABELS: Record<number, string> = {
  0: "Empty",
  25: "¼",
  50: "½",
  75: "¾",
  100: "Full",
};

/** "empty", "¼ full", "full" — or "37% full" for a value off the steps. */
export function describeFillLevel(percent: number): string {
  if (percent <= 0) return "empty";
  if (percent >= 100) return "full";
  const step = STEP_LABELS[percent];
  return step ? `${step} full` : `${percent}% full`;
}

export function FillLevelInput({
  value,
  onChange,
  label = "How full",
}: {
  value: number | null;
  onChange: (percent: number | null) => void;
  label?: string;
}) {
  // A value off the five steps (a finer scale later, or an integration) still
  // shows as the nearest step so the control never looks unset while holding
  // a real value.
  const nearest =
    value == null
      ? null
      : FILL_STEPS.reduce((best, step) =>
          Math.abs(step - value) < Math.abs(best - value) ? step : best,
        );
  return (
    <div>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {value != null && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => onChange(null)}
          >
            Clear
          </Button>
        )}
      </Group>
      <SegmentedControl
        fullWidth
        size="md"
        data={FILL_STEPS.map((step) => ({
          value: String(step),
          label: STEP_LABELS[step] ?? `${step}%`,
        }))}
        // Mantine has no "nothing selected" state, so an unset value points
        // the control at an off-list value and no segment lights up.
        value={nearest == null ? "unset" : String(nearest)}
        onChange={(v) => onChange(Number(v))}
      />
    </div>
  );
}

/** Compact read-only rendering for headers and list rows. */
export function FillLevelBadge({
  percent,
  size = "sm",
}: {
  percent: number | null;
  size?: "xs" | "sm";
}) {
  if (percent == null) return null;
  return (
    <Badge
      variant="light"
      color={percent >= 100 ? "orange" : percent <= 0 ? "gray" : "teal"}
      size={size}
      style={{ textTransform: "none" }}
    >
      {describeFillLevel(percent)}
    </Badge>
  );
}
