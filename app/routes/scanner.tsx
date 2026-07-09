/**
 * The root page IS a camera, and auto-scan is the primary usage mode: the
 * viewfinder never leaves the screen. Scanning a sticker makes that bin
 * "current" — its contents/history peek up over the camera (BinPeek) and a
 * big "Capture contents of #N" button pins to the bottom. Detection keeps
 * running the whole time, so pointing at a different box's QR switches to it
 * automatically. Unclaimed or not-yet-synced bins still open the full bin
 * page (claiming needs input). barcode-detector ponyfill = native
 * BarcodeDetector where available (Android Chrome, Safari 17+), zxing-wasm
 * elsewhere.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDocumentTitle, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconBoxMultiple,
  IconBulb,
  IconBulbOff,
  IconCamera,
  IconCameraOff,
  IconInfoCircle,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { BinPeek } from "~/components/BinPeek";
import { SyncBadge } from "~/components/SyncBadge";
import { addPhoto } from "~/lib/actions";
import {
  getCameraStream,
  setTorch,
  stopCamera,
  torchCapableTrack,
} from "~/lib/camera";
import { db, getMeta, setMeta } from "~/lib/db";
import { type ScanTarget, binIdFromScan } from "~/lib/format";
import { captureFromVideo } from "~/lib/photos";
import { DESKTOP_MEDIA, PAGE_MAXW } from "~/lib/ui";

// Self-host the ponyfill's wasm: the default fetches from a CDN at runtime,
// which is useless offline. As a hashed local asset it lands in the service
// worker precache, so iPhones (no native BarcodeDetector) scan in dead zones.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
});

const DETECT_INTERVAL_MS = 125; // ~8/s — faster only burns battery.
const DUPLICATE_SUPPRESS_MS = 2500;
/** Meta key: the auto-scan mode's current bin, restored across visits. */
const CURRENT_BIN_KEY = "currentBin";

function useScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  // Desktop scans opt-in (enabled) and must turn the webcam LED off when the
  // scanner goes away (releaseOnExit); phones keep the stream for reuse.
  { enabled, releaseOnExit }: { enabled: boolean; releaseOnExit: boolean },
  onHit: (target: ScanTarget) => void,
) {
  const [cameraError, setCameraError] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const onHitRef = useRef(onHit);
  onHitRef.current = onHit;

  useEffect(() => {
    if (!enabled) return;
    setCameraError(false);
    let stopped = false;
    let lastDetect = 0;
    let lastHit: { value: string; at: number } | null = null;
    let inFlight = false;
    const detector = new BarcodeDetector({ formats: ["qr_code"] });

    async function tick() {
      const video = videoRef.current;
      if (stopped || !video || !video.videoWidth) return;
      const now = performance.now();
      if (inFlight || now - lastDetect < DETECT_INTERVAL_MS) return;
      lastDetect = now;
      inFlight = true;
      try {
        const codes = await detector.detect(video);
        for (const code of codes) {
          const value = code.rawValue;
          if (
            lastHit &&
            lastHit.value === value &&
            Date.now() - lastHit.at < DUPLICATE_SUPPRESS_MS
          ) {
            continue;
          }
          const target = binIdFromScan(value);
          if (target !== null) {
            lastHit = { value, at: Date.now() };
            onHitRef.current(target);
            break;
          }
        }
      } catch {
        // Detector hiccups on some frames — just try the next one.
      } finally {
        inFlight = false;
      }
    }

    let rafId = 0;
    function loop() {
      if (stopped) return;
      void tick();
      const video = videoRef.current as
        | (HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
          })
        | null;
      if (video?.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(loop);
      } else {
        rafId = requestAnimationFrame(loop);
      }
    }

    async function start() {
      try {
        const stream = await getCameraStream();
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        setTorchAvailable(torchCapableTrack() !== null);
        loop();
      } catch {
        if (!stopped) setCameraError(true);
      }
    }
    void start();

    const onVisible = () => {
      // iOS killed the stream while hidden — re-acquire and resume.
      if (document.visibilityState === "visible") void start();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisible);
      if (releaseOnExit) {
        stopCamera();
        if (videoRef.current) videoRef.current.srcObject = null;
      }
      // Otherwise leave the stream running: bin-page captures reuse it.
    };
  }, [videoRef, enabled, releaseOnExit]);

  return { cameraError, torchAvailable };
}

/** Type-a-number fallback: hand-entered ids go through the same scan path. */
function ManualBinInput({
  onSubmit,
}: {
  onSubmit: (target: ScanTarget) => void;
}) {
  const [value, setValue] = useState("");
  const target = binIdFromScan(value.trim());
  return (
    <Group gap="xs" wrap="nowrap">
      <TextInput
        size="lg"
        inputMode="numeric"
        placeholder="123"
        value={value}
        style={{ flex: 1 }}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && target) onSubmit(target);
        }}
      />
      <Button
        size="lg"
        variant="default"
        disabled={!target}
        onClick={() => target && onSubmit(target)}
      >
        Go
      </Button>
    </Group>
  );
}

export default function Scanner() {
  // Other routes set their own titles; reset when landing back on the camera.
  useDocumentTitle("bins");
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [currentBinId, setCurrentBinId] = useState<number | null>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // A desktop's camera faces the user, not the boxes — there the scanner is
  // opt-in ("Start camera") behind a card that also takes a typed bin number.
  const isDesktop =
    useMediaQuery(DESKTOP_MEDIA, false, { getInitialValueInEffect: false }) ??
    false;
  const [desktopCameraOn, setDesktopCameraOn] = useState(false);
  const scanning = !isDesktop || desktopCameraOn;

  // Restore the last worked-on bin across visits — collapsed, so returning
  // from search/settings lands on a clean camera with context intact.
  useEffect(() => {
    void (async () => {
      const id = await getMeta<number>(CURRENT_BIN_KEY);
      if (id && (await db.bins.get(id))?.status === "active") {
        setCurrentBinId((current) => current ?? id);
      }
    })();
  }, []);

  function makeCurrent(binId: number) {
    setCurrentBinId(binId);
    setPeekOpen(true);
    void setMeta(CURRENT_BIN_KEY, binId);
  }

  async function onScan(target: ScanTarget) {
    // Same box again: don't re-pop a peek the user collapsed.
    if (target.binId === currentBinId) return;
    const bin = await db.bins.get(target.binId);
    if (bin && bin.status !== "unclaimed") {
      makeCurrent(target.binId);
    } else {
      // Unclaimed (claim flow) or not in the replica (sync dead-end): those
      // conversations need the full page.
      navigate(`/${target.binId}`);
    }
  }

  const { cameraError, torchAvailable } = useScanner(
    videoRef,
    { enabled: scanning, releaseOnExit: isDesktop },
    (target) => {
      void onScan(target);
    },
  );

  async function captureContents() {
    const video = videoRef.current;
    if (!video || currentBinId === null || capturing) return;
    setCapturing(true);
    try {
      const photo = await captureFromVideo(video);
      await addPhoto(currentBinId, "contents_photo", photo);
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      notifications.show({
        message: `Contents photo saved to #${currentBinId}`,
        color: "green",
      });
    } catch (err) {
      notifications.show({ message: `Capture failed: ${err}`, color: "red" });
    } finally {
      setCapturing(false);
    }
  }

  const recentBins = useLiveQuery(
    async () =>
      (await db.bins.orderBy("updatedAt").reverse().limit(20).toArray())
        .filter((bin) => bin.status === "active")
        .slice(0, 8),
    [],
    [],
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      {/* biome-ignore lint/a11y/useMediaCaption: live camera viewfinder */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* Reticle */}
      {scanning && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -60%)",
            width: "min(65vw, 65vh)",
            aspectRatio: "1",
            border: "3px solid rgba(255,255,255,0.7)",
            borderRadius: 24,
            boxShadow: "0 0 0 100vmax rgba(0,0,0,0.35)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Shutter flash */}
      {flash && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#fff",
            opacity: 0.7,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Top bar */}
      <Group
        justify="space-between"
        p="md"
        style={{
          position: "absolute",
          top: "env(safe-area-inset-top)",
          left: 0,
          right: 0,
        }}
      >
        <Text fw={700} c="white" size="lg">
          bins
        </Text>
        <Group gap="xs">
          <SyncBadge />
          {torchAvailable && (
            <ActionIcon
              variant="default"
              size="xl"
              radius="xl"
              onClick={() => {
                void setTorch(!torchOn);
                setTorchOn(!torchOn);
              }}
              aria-label="Toggle flashlight"
            >
              {torchOn ? <IconBulbOff /> : <IconBulb />}
            </ActionIcon>
          )}
          {isDesktop && desktopCameraOn && (
            <ActionIcon
              variant="default"
              size="xl"
              radius="xl"
              onClick={() => setDesktopCameraOn(false)}
              aria-label="Stop camera"
            >
              <IconCameraOff />
            </ActionIcon>
          )}
        </Group>
      </Group>

      {/* Desktop landing: camera is opt-in, typing a number is first-class */}
      {isDesktop && !desktopCameraOn && (
        <Paper
          p="lg"
          radius="lg"
          style={{
            position: "absolute",
            top: "28%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(90vw, 420px)",
          }}
        >
          <Stack gap="sm">
            <Text ta="center" fw={600}>
              Scan a box sticker
            </Text>
            <Button
              size="lg"
              leftSection={<IconCamera size={20} />}
              onClick={() => setDesktopCameraOn(true)}
            >
              Start camera
            </Button>
            <Divider label="or type a bin number" labelPosition="center" />
            <ManualBinInput onSubmit={(target) => void onScan(target)} />
          </Stack>
        </Paper>
      )}

      {scanning && cameraError && (
        <Paper
          p="md"
          radius="lg"
          style={{
            position: "absolute",
            top: "30%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(calc(100vw - 32px), 420px)",
          }}
        >
          <Text ta="center" mb="xs">
            Camera unavailable. Type a bin number instead:
          </Text>
          <ManualBinInput onSubmit={(target) => void onScan(target)} />
        </Paper>
      )}

      {/* Bottom: peek panel + capture + recent bins + nav */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: 12,
          paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
          background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: PAGE_MAXW,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {currentBinId !== null && peekOpen && (
            <BinPeek
              binId={currentBinId}
              onCollapse={() => setPeekOpen(false)}
            />
          )}

          {currentBinId !== null && scanning && (
            <Group gap="xs" wrap="nowrap">
              <Button
                size="lg"
                h={60}
                radius="md"
                style={{ flex: 1 }}
                leftSection={<IconCamera size={24} />}
                onClick={() => void captureContents()}
                loading={capturing}
                disabled={cameraError}
              >
                Capture contents of #{currentBinId}
              </Button>
              {!peekOpen && (
                <ActionIcon
                  variant="default"
                  size={60}
                  radius="md"
                  onClick={() => setPeekOpen(true)}
                  aria-label="Show bin details"
                >
                  <IconInfoCircle />
                </ActionIcon>
              )}
            </Group>
          )}

          {!peekOpen && recentBins.length > 0 && (
            <Group gap="xs" style={{ overflowX: "auto", flexWrap: "nowrap" }}>
              {recentBins.map((bin) => (
                <Badge
                  key={bin.id}
                  size="lg"
                  variant="light"
                  onClick={() => makeCurrent(bin.id)}
                  style={{
                    cursor: "pointer",
                    flexShrink: 0,
                    textTransform: "none",
                  }}
                >
                  #{bin.id}
                  {bin.name ? ` ${bin.name}` : ""}
                </Badge>
              ))}
            </Group>
          )}

          <Group justify="center" gap="xl">
            <ActionIcon
              component={Link}
              to="/bins"
              variant="default"
              size={56}
              radius="xl"
              aria-label="All boxes"
            >
              <IconBoxMultiple />
            </ActionIcon>
            <ActionIcon
              component={Link}
              to="/search"
              variant="default"
              size={56}
              radius="xl"
              aria-label="Search"
            >
              <IconSearch />
            </ActionIcon>
            <ActionIcon
              component={Link}
              to="/settings"
              variant="default"
              size={56}
              radius="xl"
              aria-label="Settings"
            >
              <IconSettings />
            </ActionIcon>
          </Group>
        </div>
      </div>
    </div>
  );
}
