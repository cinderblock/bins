/**
 * Bottom sheet on phones, centered modal on wide viewports. The app's edit
 * surfaces (location, note, labels, move, edit) are designed as thumb-reach
 * bottom drawers; past phone width those stretch edge-to-edge, so desktop
 * gets a centered modal with the same content.
 */
import { Drawer, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { ReactNode } from "react";
import { PHONE_MEDIA } from "~/lib/ui";

export function ResponsiveSheet({
  opened,
  onClose,
  title,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const phone = useMediaQuery(PHONE_MEDIA, true, {
    getInitialValueInEffect: false,
  });
  if (phone) {
    return (
      <Drawer
        opened={opened}
        onClose={onClose}
        position="bottom"
        radius="lg"
        size="auto"
        title={title}
        padding="md"
      >
        {children}
      </Drawer>
    );
  }
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="lg"
      title={title}
      padding="md"
    >
      {children}
    </Modal>
  );
}
