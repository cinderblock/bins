/**
 * Shared MediaStream singleton. The scanner and the capture overlay reuse ONE
 * stream — re-negotiating getUserMedia between scans costs 0.5–1.5s and (on
 * iOS) sometimes a permission re-prompt, which would kill the
 * scan → snap → next-box rhythm. iOS kills backgrounded streams, so callers
 * always go through getCameraStream(), which checks track liveness.
 */
let stream: MediaStream | null = null;
let visibilityHooked = false;

/**
 * iOS pauses/ducks other apps' audio (Music, podcasts) when ANY capture
 * starts, even video-only: the capture pipeline puts the OS audio session in
 * a record category that interrupts ongoing playback. Declaring our session
 * "ambient" (mixable, never takes audio focus) tells WebKit to keep music
 * playing. Safari-only API, silently absent elsewhere. Asserted at module
 * load (before the first permission prompt or any session activity) and
 * again before each getUserMedia. Re-asserting the same value after capture
 * starts is pointless: WebKit's setCategoryOverride early-returns when the
 * value is unchanged (AudioSession.cpp), so if the capture pipeline flips
 * the session underneath the override, no same-value write from JS can flip
 * it back.
 *
 * Caveat: with an explicit "ambient" session, getUserMedia({ audio: true })
 * would fail — fine here, this app never captures mic audio (voice notes are
 * dictation-first by decision).
 */
function requestAmbientAudioSession(): void {
  // Guard: this module is evaluated during the build-time SPA prerender too,
  // where `navigator` doesn't exist.
  if (typeof navigator === "undefined") return;
  const audioSession = (navigator as { audioSession?: { type: string } })
    .audioSession;
  if (audioSession) audioSession.type = "ambient";
}
requestAmbientAudioSession();

export async function getCameraStream(): Promise<MediaStream> {
  if (stream?.getVideoTracks().some((t) => t.readyState === "live")) {
    return stream;
  }
  stopCamera();
  requestAmbientAudioSession();
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
