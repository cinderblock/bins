/**
 * Shake to report.
 *
 * A shake is a run of strong accelerations that keep changing direction, which
 * is what separates it from a footstep (weak), or from setting a box down hard
 * (strong, but one way). The detector is a pure function of samples so that it
 * can be tested with no phone in the loop.
 *
 * iOS hides the sensor behind a permission that can only be requested from a
 * tap. Everywhere else it just works on a secure origin.
 */

export type Sample = { x: number; y: number; z: number; t: number };

export type ShakeTuning = {
  /** m/s², gravity removed. A brisk wrist shake easily clears this. */
  threshold: number;
  /** Direction changes that make it a shake and not a jolt. */
  reversals: number;
  windowMs: number;
  /** One shake opens one sheet, however long the arm keeps going. */
  cooldownMs: number;
};

const DEFAULT_TUNING: ShakeTuning = {
  threshold: 14,
  reversals: 4,
  windowMs: 1000,
  cooldownMs: 3000,
};

/** Feed it samples; it answers true on the one that completes a shake. */
export function createShakeDetector(
  tuning: Partial<ShakeTuning> = {},
): (sample: Sample) => boolean {
  const { threshold, reversals, windowMs, cooldownMs } = {
    ...DEFAULT_TUNING,
    ...tuning,
  };
  let lastAxis = "";
  let lastSign = 0;
  let flips: number[] = [];
  let quietUntil = 0;

  return ({ x, y, z, t }) => {
    if (t < quietUntil) return false;
    const [axis, value] = dominantAxis(x, y, z);
    if (Math.abs(value) < threshold) return false;

    const sign = Math.sign(value);
    if (axis === lastAxis && sign === lastSign) return false;
    // A change of axis is a change of direction too: people shake in arcs.
    lastAxis = axis;
    lastSign = sign;
    flips = flips.filter((at) => t - at < windowMs);
    flips.push(t);
    if (flips.length < reversals) return false;

    flips = [];
    lastAxis = "";
    lastSign = 0;
    quietUntil = t + cooldownMs;
    return true;
  };
}

function dominantAxis(x: number, y: number, z: number): [string, number] {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return ["x", x];
  return ay >= az ? ["y", y] : ["z", z];
}

type MotionPermission = { requestPermission?: () => Promise<string> };

/** Is there a sensor worth listening to, and does it need asking for? */
export function shakeSupport(): "none" | "ready" | "needs-permission" {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
    return "none";
  }
  // Desktop browsers define the event and never fire it.
  if (!window.matchMedia("(pointer: coarse)").matches) return "none";
  const api = window.DeviceMotionEvent as unknown as MotionPermission;
  return typeof api.requestPermission === "function"
    ? "needs-permission"
    : "ready";
}

/** Must run inside a tap on iOS. True when the sensor is ours to read. */
export async function requestShakePermission(): Promise<boolean> {
  const api = window.DeviceMotionEvent as unknown as MotionPermission;
  if (typeof api.requestPermission !== "function") return true;
  try {
    return (await api.requestPermission()) === "granted";
  } catch {
    // Not in a tap, or the user said no. Either way, no sensor for now.
    return false;
  }
}

/** Listen for shakes until the returned function is called. */
export function watchShake(onShake: () => void): () => void {
  const detect = createShakeDetector();
  // Only some browsers report acceleration with gravity removed, so estimate
  // gravity with a low-pass filter for the ones that don't.
  const gravity = { x: 0, y: 0, z: 0 };

  const onMotion = (event: DeviceMotionEvent) => {
    const clean = event.acceleration;
    const raw = event.accelerationIncludingGravity;
    let x: number;
    let y: number;
    let z: number;
    if (clean?.x != null && clean.y != null && clean.z != null) {
      ({ x, y, z } = clean as { x: number; y: number; z: number });
    } else if (raw?.x != null && raw.y != null && raw.z != null) {
      gravity.x = 0.8 * gravity.x + 0.2 * raw.x;
      gravity.y = 0.8 * gravity.y + 0.2 * raw.y;
      gravity.z = 0.8 * gravity.z + 0.2 * raw.z;
      x = raw.x - gravity.x;
      y = raw.y - gravity.y;
      z = raw.z - gravity.z;
    } else {
      return;
    }
    if (detect({ x, y, z, t: event.timeStamp })) onShake();
  };

  window.addEventListener("devicemotion", onMotion);
  return () => window.removeEventListener("devicemotion", onMotion);
}
