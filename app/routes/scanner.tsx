/**
 * The root page IS a camera: continuously scanning for bin QR codes and
 * navigating (replace) to the last scanned bin — scan → snap → next box.
 * barcode-detector ponyfill = native BarcodeDetector where available
 * (Android Chrome, Safari 17+), zxing-wasm elsewhere.
 */
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconBulb,
  IconBulbOff,
  IconPrinter,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { BarcodeDetector } from "barcode-detector/ponyfill";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { SyncBadge } from "~/components/SyncBadge";
import { getCameraStream, setTorch, torchCapableTrack } from "~/lib/camera";
import { db } from "~/lib/db";
import { binIdFromScan } from "~/lib/format";

const DETECT_INTERVAL_MS = 125; // ~8/s — faster only burns battery.
const DUPLICATE_SUPPRESS_MS = 2500;

function useScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onHit: (binId: number) => void,
) {
  const [cameraError, setCameraError] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const onHitRef = useRef(onHit);
  onHitRef.current = onHit;

  useEffect(() => {
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
          const binId = binIdFromScan(value);
          if (binId !== null) {
            lastHit = { value, at: Date.now() };
            onHitRef.current(binId);
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
      // Leave the stream running: bin-page captures reuse it.
    };
  }, [videoRef]);

  return { cameraError, torchAvailable };
}

export default function Scanner() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [manualId, setManualId] = useState("");

  const { cameraError, torchAvailable } = useScanner(videoRef, (binId) => {
    navigate(`/${binId}`, { replace: true });
  });

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
        </Group>
      </Group>

      {cameraError && (
        <Paper
          p="md"
          radius="lg"
          style={{
            position: "absolute",
            top: "30%",
            left: 16,
            right: 16,
          }}
        >
          <Text ta="center" mb="xs">
            Camera unavailable. Type a bin number instead:
          </Text>
          <TextInput
            size="lg"
            inputMode="numeric"
            placeholder="123"
            value={manualId}
            onChange={(e) => setManualId(e.currentTarget.value)}
            onKeyDown={(e) => {
              const id = binIdFromScan(manualId);
              if (e.key === "Enter" && id !== null) navigate(`/${id}`);
            }}
          />
        </Paper>
      )}

      {/* Bottom: recent bins + nav */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: 16,
          paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
          background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
        }}
      >
        {recentBins.length > 0 && (
          <Group
            gap="xs"
            mb="md"
            style={{ overflowX: "auto", flexWrap: "nowrap" }}
          >
            {recentBins.map((bin) => (
              <Badge
                key={bin.id}
                component={Link}
                to={`/${bin.id}`}
                size="lg"
                variant="light"
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
            to="/print"
            variant="default"
            size={56}
            radius="xl"
            aria-label="Print stickers"
          >
            <IconPrinter />
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
  );
}
