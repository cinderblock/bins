/**
 * Full-size photo viewer, shared by every surface with a photo strip (bin
 * page, scanner peek). Delete lives here one-tap with no confirm: opening
 * the lightbox is already a deliberate look at exactly this photo, and the
 * undo toast catches the rest. Fills the screen on a phone; a normal
 * centered dialog on desktop, where full-screen would be a 4K modal around
 * a modest image.
 */
import { Button, Center, Image, Modal, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { EntryState } from "@shared/reducer";
import { IconTrash } from "@tabler/icons-react";
import { useAuthors } from "~/lib/authors";
import { relativeTime } from "~/lib/format";
import { PHONE_MEDIA } from "~/lib/ui";
import { deleteEntryWithUndo } from "~/lib/undo";
import { usePhotoUrl } from "./PhotoImg";

export function PhotoLightbox({
  entry,
  onClose,
}: {
  entry: EntryState | null;
  onClose: () => void;
}) {
  const authors = useAuthors();
  const phone = useMediaQuery(PHONE_MEDIA, true, {
    getInitialValueInEffect: false,
  });
  return (
    <Modal
      opened={entry !== null}
      onClose={onClose}
      fullScreen={phone}
      size="xl"
      centered
      padding="xs"
      title={
        entry && (
          <Text size="sm" c="dimmed">
            {entry.kind === "contents_photo" ? "Contents" : "Item"} ·{" "}
            {(entry.deviceId && authors[entry.deviceId]) ?? ""}{" "}
            {relativeTime(entry.effectiveTime)}
          </Text>
        )
      }
    >
      {entry?.photoHash && <LightboxBody entry={entry} onDeleted={onClose} />}
    </Modal>
  );
}

function LightboxBody({
  entry,
  onDeleted,
}: { entry: EntryState; onDeleted: () => void }) {
  const url = usePhotoUrl(entry.photoHash, null, true);
  return (
    <Stack>
      {url ? (
        <Image src={url} radius="md" alt="photo" fit="contain" mah="75dvh" />
      ) : (
        <Center h={200}>
          <Text c="dimmed">loading…</Text>
        </Center>
      )}
      <Button
        color="red"
        variant="light"
        leftSection={<IconTrash size={16} />}
        onClick={() => {
          deleteEntryWithUndo(
            entry.binId,
            entry.id,
            entry.kind === "contents_photo" ? "Contents photo" : "Item photo",
          );
          onDeleted();
        }}
      >
        Delete photo
      </Button>
    </Stack>
  );
}
