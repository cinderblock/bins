/**
 * "…and if the thing you want isn't in the list yet."
 *
 * Every vocabulary in this app is the group's own — box sizes, categories,
 * places. Which means every picker over one has the same failure: you are
 * standing at a shelf with a box in your hands, the right answer does not
 * exist yet, and the app tells you to go and configure it somewhere else.
 * By the time you get back you have put the box down.
 *
 * So each picker gets the same escape hatch, and it behaves the same way
 * everywhere: a "+ New" button that becomes a field, an explicit Add (Enter
 * works too), and the new thing is SELECTED on creation — because you were
 * picking one, not administering a list.
 *
 * Collapsed by default on purpose. An always-open text field next to a list
 * of choices reads as a search box and invites typing into it, which is how
 * you end up with a vocabulary of near-duplicates.
 */
import { ActionIcon, Button, Group, TextInput } from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { TOUCH_TARGET } from "~/lib/ui";

export function InlineCreate({
  /** The collapsed button's words, e.g. "New shelf". */
  label,
  placeholder,
  /**
   * Create it and select it. Returning `false` keeps the field open — for a
   * caller that wants to report a problem without losing what was typed.
   */
  onCreate,
  size = "md",
}: {
  label: string;
  placeholder: string;
  onCreate: (name: string) => Promise<unknown> | unknown;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const ok = await onCreate(name);
      if (ok !== false) {
        setDraft("");
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="default"
        size={size}
        leftSection={<IconPlus size={18} />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap" align="flex-start" style={{ flex: 1 }}>
      <TextInput
        style={{ flex: 1, minWidth: 0 }}
        size={size}
        placeholder={placeholder}
        aria-label={label}
        autoFocus
        enterKeyHint="done"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft("");
            setOpen(false);
            return;
          }
          if (e.key !== "Enter") return;
          e.preventDefault();
          void submit();
        }}
      />
      <Button
        size={size}
        loading={busy}
        disabled={!draft.trim()}
        onClick={() => void submit()}
      >
        Add
      </Button>
      <ActionIcon
        size={size === "lg" ? TOUCH_TARGET : 36}
        variant="subtle"
        color="gray"
        aria-label={`Cancel ${label.toLowerCase()}`}
        onClick={() => {
          setDraft("");
          setOpen(false);
        }}
      >
        <IconX size={18} />
      </ActionIcon>
    </Group>
  );
}
