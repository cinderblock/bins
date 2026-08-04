/**
 * Delete-with-undo for bin entries. `.tsx` because the toast body carries an
 * Undo button — everything else here is plain op authoring.
 *
 * Deleting is one tap with no confirmation dialog on purpose: a confirm on
 * every delete taxes the common case (you meant it) to guard the rare one, and
 * it's useless against the actual failure — a mis-tap on a phone, where the
 * dialog gets dismissed just as reflexively. An undo affordance costs the
 * common case nothing and, because entry.restore is a real op, works even
 * after the delete has synced to everyone else. The bin page's "Deleted"
 * section is the escape hatch once the toast is gone.
 */
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { removeEntry, restoreEntry } from "./actions";

/** How long the Undo toast sticks around. */
const UNDO_MS = 8000;

/**
 * Remove an entry and offer an immediate undo. `what` names the thing in the
 * toast ("Photo deleted") — keep it a bare noun.
 */
export function deleteEntryWithUndo(
  binId: number,
  entryOpId: string,
  what: string,
): void {
  void removeEntry(binId, entryOpId);
  // Keyed by entry so double-deleting two things stacks two toasts, but
  // re-deleting the same one replaces its toast instead of piling up.
  const id = `undo-${entryOpId}`;
  notifications.show({
    id,
    autoClose: UNDO_MS,
    message: (
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm">{what} deleted</Text>
        <Button
          size="xs"
          variant="white"
          onClick={() => {
            notifications.hide(id);
            void restoreEntry(binId, entryOpId);
          }}
        >
          Undo
        </Button>
      </Group>
    ),
  });
}
