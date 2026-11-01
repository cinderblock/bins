/**
 * Bottom sheet on phones, centered modal on wide viewports. The app's edit
 * surfaces (location, note, labels, move, edit) are designed as thumb-reach
 * bottom drawers; past phone width those stretch edge-to-edge, so desktop
 * gets a centered modal with the same content.
 *
 * Phones also get a real way OUT. A drawer's only dismiss used to be
 * Mantine's ~28px close button in the top-right corner — the hardest pixel on
 * a phone to reach one-handed — which on the sheets that apply their edits
 * instantly (categories, location) meant no obvious "I'm done" at all. So the
 * close button is finger-sized here and a full-width dismiss sits at the
 * bottom, next to the thumb that opened the sheet.
 */
import { Button, Drawer, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { ReactNode } from "react";
import { PHONE_MEDIA, TOUCH_TARGET } from "~/lib/ui";

export function ResponsiveSheet({
  opened,
  onClose,
  title,
  /** Phone-only bottom dismiss. "Done" where edits apply live; null to omit. */
  dismissLabel = "Close",
  /** Left out of report screenshots: the report sheet itself. */
  screenshotIgnored = false,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  dismissLabel?: string | null;
  screenshotIgnored?: boolean;
  children: ReactNode;
}) {
  const phone = useMediaQuery(PHONE_MEDIA, true, {
    getInitialValueInEffect: false,
  });
  const rootProps = screenshotIgnored ? { "data-report-ignore": true } : {};
  if (phone) {
    return (
      <Drawer
        {...rootProps}
        opened={opened}
        onClose={onClose}
        position="bottom"
        radius="lg"
        size="auto"
        title={title}
        padding="md"
        closeButtonProps={{ size: "xl", iconSize: 26, "aria-label": "Close" }}
      >
        {children}
        {dismissLabel !== null && (
          <Button
            mt="md"
            mb="env(safe-area-inset-bottom)"
            fullWidth
            h={TOUCH_TARGET}
            variant="default"
            onClick={onClose}
          >
            {dismissLabel}
          </Button>
        )}
      </Drawer>
    );
  }
  return (
    <Modal
      {...rootProps}
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
