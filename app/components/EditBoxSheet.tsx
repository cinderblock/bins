/**
 * Editing a box's identity — name, size, external label — from the bin page.
 *
 * One sheet, two outcomes. An admin with the password unlocked writes straight
 * through (bin.setFields, like any other edit). Everyone else SUGGESTS: the
 * same form, but it queues a bin.suggest for an admin to approve, because a
 * box's name and size are how the whole group finds it again and a drive-by
 * rename is expensive to notice. Everything else a member can change (location,
 * categories, weight, photos, notes) still applies instantly.
 *
 * Both paths are offline-first — a suggestion is an ordinary op in the outbox.
 */
import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { SuggestFields } from "@shared/ops";
import type { BinState } from "@shared/reducer";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { setBinFields, suggestBinEdit } from "~/lib/actions";
import { describeSize, useBoxSizes } from "~/lib/boxSizes";
import { usePendingSuggestions } from "~/lib/suggestions";

/**
 * The legacy hardcoded list. Kept ONLY as a fallback for a replica that has
 * not yet pulled any size definitions — a box that still carries free-text
 * `sizeClass` must remain editable rather than silently losing its value.
 */
const SIZE_CLASSES = ["S", "M", "L", "XL"];

export function EditBoxSheet({
  bin,
  canEditDirectly,
  opened,
  onClose,
}: {
  bin: BinState;
  /** Admin unlocked on this device — writes apply instead of queueing. */
  canEditDirectly: boolean;
  opened: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(bin.name ?? "");
  const [sizeClass, setSizeClass] = useState(bin.sizeClass ?? "");
  const [sizeId, setSizeId] = useState<string | null>(bin.sizeId ?? null);
  const sizes = useBoxSizes();
  const [externalLabel, setExternalLabel] = useState(bin.externalLabel ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = usePendingSuggestions(bin.id);

  // The sheet stays mounted; re-seed from the live bin each time it opens so
  // it never shows values that went stale while it was closed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed only on open
  useEffect(() => {
    if (!opened) return;
    setName(bin.name ?? "");
    setSizeClass(bin.sizeClass ?? "");
    setSizeId(bin.sizeId ?? null);
    setExternalLabel(bin.externalLabel ?? "");
    setNote("");
  }, [opened]);

  /** Only what actually changed — an untouched field stays out of the op. */
  function changedFields(): SuggestFields {
    const fields: SuggestFields = {};
    const next = {
      name: name.trim() || null,
      sizeClass: sizeClass || null,
      sizeId,
      externalLabel: externalLabel.trim() || null,
    };
    if (next.name !== (bin.name ?? null)) fields.name = next.name;
    if (next.sizeClass !== (bin.sizeClass ?? null))
      fields.sizeClass = next.sizeClass;
    if (next.sizeId !== (bin.sizeId ?? null)) fields.sizeId = next.sizeId;
    if (next.externalLabel !== (bin.externalLabel ?? null))
      fields.externalLabel = next.externalLabel;
    return fields;
  }

  const fields = changedFields();
  const changed = Object.keys(fields).length > 0;

  async function submit() {
    setBusy(true);
    try {
      if (canEditDirectly) {
        await setBinFields(bin.id, fields);
        notifications.show({ message: `Saved #${bin.id}`, color: "green" });
      } else {
        await suggestBinEdit(bin.id, fields, note.trim() || null);
        notifications.show({
          message: "Sent to an admin to approve",
          color: "green",
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title={
        canEditDirectly ? `Edit #${bin.id}` : `Suggest a change to #${bin.id}`
      }
      dismissLabel="Cancel"
    >
      <Stack gap="sm">
        {!canEditDirectly && (
          <Alert
            variant="light"
            color="blue"
            icon={<IconInfoCircle size={18} />}
            p="xs"
          >
            <Text size="sm">
              A box's name and size are how everyone finds it, so changes go to
              an admin first. Location, categories, weight, photos and notes you
              can change yourself, right away.
            </Text>
          </Alert>
        )}
        {pending.length > 0 && (
          <Text size="xs" c="dimmed">
            {pending.length === 1
              ? "1 change is already waiting for an admin."
              : `${pending.length} changes are already waiting for an admin.`}
          </Text>
        )}
        <TextInput
          label="Name"
          placeholder="e.g. Kitchen gear"
          size="md"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        {sizes.length > 0 ? (
          // Group-defined box types (admin-managed). Clearable, because "no
          // size recorded" is a real answer and not the same as guessing one.
          <Select
            label="Size"
            placeholder="Not set"
            size="md"
            clearable
            searchable={sizes.length > 8}
            data={sizes.map((s) => ({ value: s.id, label: describeSize(s) }))}
            value={sizeId}
            onChange={setSizeId}
          />
        ) : (
          <div>
            <Text size="sm" fw={500} mb={4}>
              Size
            </Text>
            {/* No definitions synced yet — fall back to the legacy free-text
                field so an existing value stays editable. An admin defines
                real sizes in /admin. */}
            <SegmentedControl
              fullWidth
              size="md"
              data={SIZE_CLASSES}
              value={SIZE_CLASSES.includes(sizeClass) ? sizeClass : ""}
              onChange={setSizeClass}
            />
          </div>
        )}
        <TextInput
          label="External label"
          placeholder="what's written on the outside, e.g. K1 / red tape"
          size="md"
          value={externalLabel}
          onChange={(e) => setExternalLabel(e.currentTarget.value)}
        />
        {!canEditDirectly && (
          <Textarea
            label="Why (optional)"
            placeholder="e.g. the tape on the lid says K1, not K7"
            autosize
            minRows={2}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        )}
        <Group grow>
          <Button
            size="md"
            disabled={!changed}
            loading={busy}
            onClick={() => void submit()}
          >
            {canEditDirectly ? "Save" : "Send to an admin"}
          </Button>
        </Group>
      </Stack>
    </ResponsiveSheet>
  );
}
