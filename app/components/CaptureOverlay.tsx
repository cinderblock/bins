/**
 * Full-screen in-app viewfinder (portal over the bin page): stream already
 * live from the camera singleton, giant shutter, ~1s total per shot. A hidden
 * file input remains as the "system camera" escape hatch.
 */
import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconPhotoUp, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { addPhoto } from "~/lib/actions";
import { getCameraStream, stopCamera } from "~/lib/camera";
import { captureFromVideo, processFile } from "~/lib/photos";
import { DESKTOP_MEDIA } from "~/lib/ui";

export function CaptureOverlay({
  binId,
  kind,
  onClose,
}: {
  binId: number;
  kind: "contents_photo" | "item_photo";
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // Desktops turn the webcam (and its LED) off when the overlay closes; on
  // phones the shared stream stays live for the scan → snap rhythm.
  const isDesktop =
    useMediaQuery(DESKTOP_MEDIA, false, { getInitialValueInEffect: false }) ??
    false;

  useEffect(() => {
    let cancelled = false;
    void getCameraStream()
      .then((stream) => {
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        void videoRef.current.play().then(() => setReady(true));
      })
      .catch(() => {
        notifications.show({
          message: "Camera unavailable — use the upload button",
          color: "yellow",
        });
      });
    return () => {
      cancelled = true;
      if (isDesktop) stopCamera();
      // On phones, don't stop the stream — the scanner reuses it.
    };
  }, [isDesktop]);

  async function save(photo: Awaited<ReturnType<typeof captureFromVideo>>) {
    await addPhoto(binId, kind, photo);
    notifications.show({
      message:
        kind === "contents_photo" ? "Contents photo saved" : "Item photo saved",
      color: "green",
    });
    onClose();
  }

  async function shutter() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      await save(await captureFromVideo(video));
    } catch (err) {
      notifications.show({ message: `Capture failed: ${err}`, color: "red" });
      setBusy(false);
    }
  }

  async function fromFile(file: File | null) {
    if (!file || busy) return;
    setBusy(true);
    try {
      await save(await processFile(file));
    } catch (err) {
      notifications.show({ message: `Photo failed: ${err}`, color: "red" });
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: live camera viewfinder */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ flex: 1, objectFit: "cover", minHeight: 0 }}
      />
      <Group
        justify="space-between"
        p="md"
        pb="calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom))"
        style={{ background: "#000" }}
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xl"
          onClick={onClose}
          aria-label="Cancel"
        >
          <IconX />
        </ActionIcon>
        <Button
          size="xl"
          radius="xl"
          h={72}
          w={72}
          p={0}
          onClick={() => void shutter()}
          loading={busy}
          disabled={!ready}
          aria-label="Take photo"
        >
          <IconCamera size={32} />
        </Button>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xl"
          onClick={() => fileRef.current?.click()}
          aria-label="Use system camera"
        >
          <IconPhotoUp />
        </ActionIcon>
      </Group>
      <Text
        size="sm"
        c="gray.4"
        ta="center"
        style={{
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          left: 0,
          right: 0,
        }}
      >
        {kind === "contents_photo" ? "Top-down contents shot" : "Item photo"}
      </Text>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void fromFile(e.currentTarget.files?.[0] ?? null)}
      />
    </div>
  );
}
