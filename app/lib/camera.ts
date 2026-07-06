/**
 * Shared MediaStream singleton. The scanner and the capture overlay reuse ONE
 * stream — re-negotiating getUserMedia between scans costs 0.5–1.5s and (on
 * iOS) sometimes a permission re-prompt, which would kill the
 * scan → snap → next-box rhythm. iOS kills backgrounded streams, so callers
 * always go through getCameraStream(), which checks track liveness.
 */
let stream: MediaStream | null = null;
let visibilityHooked = false;

export async function getCameraStream(): Promise<MediaStream> {
  if (stream?.getVideoTracks().some((t) => t.readyState === "live")) {
    return stream;
  }
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      // High enough for "what's in this box" photos; QR decode is fine too.
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  if (!visibilityHooked) {
    visibilityHooked = true;
    document.addEventListener("visibilitychange", () => {
      // iOS kills the tracks anyway when hidden; free the camera promptly so
      // the OS indicator turns off. Consumers re-acquire on their next mount.
      if (document.visibilityState === "hidden") stopCamera();
    });
  }
  return stream;
}

export function stopCamera(): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  stream = null;
}

/** Torch (Android only — iOS never exposes the capability). */
export function torchCapableTrack(): MediaStreamTrack | null {
  const track = stream?.getVideoTracks()[0];
  if (!track) return null;
  const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
  return caps?.torch ? track : null;
}

export async function setTorch(on: boolean): Promise<void> {
  const track = torchCapableTrack();
  if (!track) return;
  await track.applyConstraints({
    advanced: [{ torch: on } as MediaTrackConstraintSet],
  });
}
