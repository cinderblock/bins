/**
 * Delete affordance for photos and notes on BROWSE surfaces — the desk-mode
 * detail pane, the scanner peek — where you're moving through boxes rather
 * than studying one, so a stray tap is likely. Two taps by design: the first
 * arms it into a red "Delete?", the second fires. The bin page's own controls
 * stay one-tap — there you're looking straight at the thing — and every path
 * still ends in deleteEntryWithUndo, so the undo toast backs it all up.
 */
import { ActionIcon, Button } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { deleteEntryWithUndo } from "~/lib/undo";

/** How long the armed "Delete?" waits before standing down. */
const DISARM_MS = 4000;

export function DeleteEntryButton({
  binId,
  entryId,
  what,
}: {
  binId: number;
  entryId: string;
  /** Names the thing in the toast ("Note", "Contents photo") — a bare noun. */
  what: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), DISARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <Button
        size="compact-xs"
        color="red"
        onClick={() => {
          setArmed(false);
          deleteEntryWithUndo(binId, entryId, what);
        }}
      >
        Delete?
      </Button>
    );
  }
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      onClick={() => setArmed(true)}
      aria-label={`Delete ${what.toLowerCase()}`}
    >
      <IconTrash size={14} />
    </ActionIcon>
  );
}
