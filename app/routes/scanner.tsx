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
import type { BinState } from "@shared/reducer";
import {
  IconBoxMultiple,
  IconBulb,
  IconBulbOff,
  IconCamera,
  IconCameraOff,
  IconInfoCircle,
  IconPackageImport,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { BinPeek } from "~/components/BinPeek";
import { BindStickerSheet } from "~/components/BindStickerSheet";
import { PutawayBar } from "~/components/PutawayBar";
import { addPhoto } from "~/lib/actions";
import { recordSighting } from "~/lib/actions";
import { setBinLocation } from "~/lib/actions";
import {
  boxPath,
  boxTitle,
  findBox,
  useBoxNumbersInternal,
  useBoxTitle,
} from "~/lib/boxRef";
import {
  getCameraStream,
  setTorch,
  stopCamera,
  torchCapableTrack,
} from "~/lib/camera";
import { db, getMeta, setMeta } from "~/lib/db";
import { setDeskMode } from "~/lib/deskMode";
import {
  type ScanTarget,
  binIdFromScan,
  placeCodeFromScan,
} from "~/lib/format";
import { captureFromVideo } from "~/lib/photos";
import { findPlaceByCode, usePlaceMap } from "~/lib/places";
import {
  rememberRecentPlace,
  setPutawayPlace,
  usePutawayPlaceId,
  useRecentPlaceIds,
} from "~/lib/putaway";
import { captureErrorMessage } from "~/lib/storage";
import { DESKTOP_MEDIA, PAGE_MAXW, TOUCH_TARGET } from "~/lib/ui";
import { photoSavedWithUndo } from "~/lib/undo";

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
  /**
   * Every code read, with the box it names when it names one.
   *
   * The RAW value matters now: a shelf's own sticker is an opaque string
   * printed long before this app existed, so it can't be recognised by
   * shape — only by looking it up. Unrecognisable codes still arrive here
   * and the caller ignores them; the duplicate suppressor below keeps a
   * stray QR sitting in frame from firing more than once every couple of
   * seconds.
   */
  onHit: (hit: { raw: string; target: ScanTarget | null }) => void,
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
          lastHit = { value, at: Date.now() };
          onHitRef.current({ raw: value, target: binIdFromScan(value) });
          break;
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
  const numbersInternal = useBoxNumbersInternal();
  const currentTitle = useBoxTitle(currentBinId);
  const [peekOpen, setPeekOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // --- put-away -------------------------------------------------------------
  // Filing boxes onto a shelf: the shelf sticks, and every box scanned lands
  // on it. See lib/putaway.ts for why the shelf is remembered per device.
  const [putaway, setPutaway] = useState(false);
  const byId = usePlaceMap();
  const putawayPlaceId = usePutawayPlaceId();
  const putawayPlace = putawayPlaceId
    ? (byId.get(putawayPlaceId) ?? null)
    : null;
  const recentIds = useRecentPlaceIds();
  const recentPlaces = recentIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p && !p.archived);
  const [filedCount, setFiledCount] = useState(0);
  // An unrecognised sticker, waiting to be told which shelf it is on.
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  // Refs because onScan is called from the detector loop, which closes over
  // the render it was registered in.
  const putawayRef = useRef(putaway);
  putawayRef.current = putaway;
  const putawayPlaceRef = useRef(putawayPlace);
  putawayPlaceRef.current = putawayPlace;
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

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

  /**
   * A code that isn't a box: in put-away, the shelf stickers. Returns true
   * when it was consumed, so a box scan isn't also attempted.
   */
  function onPlaceCode(raw: string): boolean {
    if (!putawayRef.current) return false;
    const code = placeCodeFromScan(raw);
    if (!code) return false;
    const { place, ambiguous } = findPlaceByCode(byIdRef.current, code);
    if (!place) {
      // Not known yet — this is the moment to learn it, with the sticker
      // still in front of the camera.
      setUnknownCode(code);
      return true;
    }
    if (ambiguous) {
      notifications.show({
        message: `More than one shelf claims that sticker — using ${place.name}. Fix it in Shelves.`,
        color: "orange",
      });
    }
    void pickPlace(place.id);
    return true;
  }

  async function pickPlace(placeId: string) {
    const place = byIdRef.current.get(placeId);
    await setPutawayPlace(placeId);
    setFiledCount(0);
    if (place)
      notifications.show({
        message: `Filing onto ${place.name}. Scan boxes to put them here.`,
        color: "blue",
      });
  }

  /** Put a scanned box on the current shelf, or ask for one first. */
  async function fileBox(bin: BinState): Promise<void> {
    const place = putawayPlaceRef.current;
    if (!place) {
      notifications.show({
        message: "Pick a shelf first — scan its sticker or tap a recent one.",
        color: "orange",
      });
      return;
    }
    await setBinLocation(bin.id, { locationId: place.id });
    await rememberRecentPlace(place.id);
    setFiledCount((n) => n + 1);
    notifications.show({
      message: `${boxTitle(bin, numbersInternal)} → ${place.name}`,
      color: "green",
    });
  }

  async function onScan(target: ScanTarget) {
    // A bare number is not a sticker here: only handles are printed, so a
    // numeric code is someone else's QR, not one of ours.
    if (numbersInternal && target.handle === null) return;
    const bin = await findBox(target);
    // Put-away: the box goes on the shelf and the camera stays ready for the
    // next one. No navigation, no peek — the whole point is rhythm.
    if (putawayRef.current) {
      if (bin) {
        void recordSighting(bin.id, "scanner", target.code);
        await fileBox(bin);
      } else {
        notifications.show({
          message: "That box isn't in this group yet.",
          color: "orange",
        });
      }
      return;
    }
    // Same box again: don't re-pop a peek the user collapsed.
    if (bin ? bin.id === currentBinId : target.binId === currentBinId) return;
    // Seen, by the in-app camera, with whatever code the sticker carried.
    if (bin) void recordSighting(bin.id, "scanner", target.code);
    if (bin && bin.status !== "unclaimed") {
      makeCurrent(bin.id);
    } else if (bin) {
      // Unclaimed: the claim flow needs the full page.
      navigate(boxPath(bin, numbersInternal));
    } else {
      // Not in the replica (sync dead-end): the page explains itself. Keep
      // the scanned form so the address bar matches the sticker.
      navigate(target.handle ? `/b/${target.handle}` : `/${target.binId}`);
    }
  }

  const { cameraError, torchAvailable } = useScanner(
    videoRef,
    { enabled: scanning, releaseOnExit: isDesktop },
    ({ raw, target }) => {
      // Shelf stickers first: in put-away they are the thing most likely to
      // be in frame, and they never look like a box URL.
      if (onPlaceCode(raw)) return;
      if (target) void onScan(target);
    },
  );

  async function captureContents() {
    const video = videoRef.current;
    if (!video || currentBinId === null || capturing) return;
    setCapturing(true);
    try {
      const photo = await captureFromVideo(video);
      const entryOpId = await addPhoto(currentBinId, "contents_photo", photo);
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      photoSavedWithUndo(
        currentBinId,
        entryOpId,
        `Contents photo saved to ${currentTitle}`,
      );
    } catch (err) {
      notifications.show({ message: captureErrorMessage(err), color: "red" });
    } finally {
      setCapturing(false);
    }
  }

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
          top: "calc(env(safe-area-inset-top) + var(--bins-banner-h, 0px))",
          left: 0,
          right: 0,
        }}
      >
        <Text fw={700} c="white" size="lg">
          bins
        </Text>
        <Group gap="xs">
          {/* Put-away: the other thing a camera is for here. Labelled, not a
              bare glyph — see the nav row at the bottom for why. */}
          {scanning && (
            <Button
              variant={putaway ? "filled" : "default"}
              size="md"
              radius="xl"
              leftSection={<IconPackageImport size={18} />}
              onClick={() => {
                setPutaway((on) => !on);
                setFiledCount(0);
              }}
            >
              {putaway ? "Putting away" : "Put away"}
            </Button>
          )}
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
            {/* The other job this machine does: no camera at all, just work
                through what's already photographed. Sticks, so the next visit
                opens straight on browse instead of a viewfinder. */}
            <Button
              size="lg"
              variant="default"
              leftSection={<IconSearch size={20} />}
              onClick={() => {
                void setDeskMode(true);
                navigate("/bins", { state: { focusSearch: true } });
              }}
            >
              Browse &amp; search instead
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
          {putaway && scanning && (
            <PutawayBar
              place={putawayPlace}
              byId={byId}
              recent={recentPlaces}
              filed={filedCount}
              onPick={(id) => void pickPlace(id)}
              onClear={() => {
                void setPutawayPlace(null);
                setFiledCount(0);
              }}
            />
          )}

          {!putaway && currentBinId !== null && peekOpen && (
            <BinPeek
              binId={currentBinId}
              onCollapse={() => setPeekOpen(false)}
            />
          )}

          {!putaway && currentBinId !== null && scanning && (
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
                Capture contents of {currentTitle}
              </Button>
              {!peekOpen && (
                <Button
                  variant="default"
                  size="lg"
                  h={60}
                  radius="md"
                  onClick={() => setPeekOpen(true)}
                  leftSection={<IconInfoCircle size={20} />}
                >
                  Details
                </Button>
              )}
            </Group>
          )}

          {/* Labelled, not three bare circles. Nobody should have to decode
              a glyph to find the box list, and a hover tooltip is invisible
              on the phone this is used from. */}
          <Group justify="center" gap="xs" grow>
            <Button
              component={Link}
              to="/bins"
              variant="default"
              size="md"
              leftSection={<IconBoxMultiple size={18} />}
            >
              All boxes
            </Button>
            <Button
              component={Link}
              to="/bins"
              state={{ focusSearch: true }}
              variant="default"
              size="md"
              leftSection={<IconSearch size={18} />}
            >
              Search
            </Button>
            <Button
              component={Link}
              to="/settings"
              variant="default"
              size="md"
              leftSection={<IconSettings size={18} />}
            >
              Settings
            </Button>
          </Group>
        </div>
      </div>

      <BindStickerSheet
        code={unknownCode}
        byId={byId}
        onClose={() => setUnknownCode(null)}
        onBound={(placeId) => {
          setUnknownCode(null);
          void pickPlace(placeId);
        }}
      />
    </div>
  );
}
