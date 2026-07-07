/**
 * Render the PWA icon set into public/ from one inline SVG design: a storage
 * tote with a QR finder eye. Re-run after changing the artwork:
 *   bun scripts/generate-icons.ts
 *
 * Regular icons get the rounded-square look baked in; the maskable icon is
 * full-bleed with the artwork shrunk into the ~80% safe zone (the platform
 * applies its own mask); the apple-touch-icon is full-bleed square (iOS
 * rounds it). favicon.svg is written as-is for browser tabs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const BG = "#242424"; // matches the app's pre-CSS background (app/root.tsx)
const BLUE = "#4dabf7"; // Mantine blue.4 — reads well on dark at small sizes

/**
 * @param bgRadius corner radius of the background square (0 = full bleed)
 * @param artScale shrink factor for the artwork (maskable safe zone)
 */
function iconSvg(bgRadius: number, artScale = 1): string {
  const g = `translate(${256 * (1 - artScale)} ${256 * (1 - artScale)}) scale(${artScale})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${bgRadius}" fill="${BG}"/>
  <g transform="${g}">
    <!-- tote lid -->
    <rect x="76" y="120" width="360" height="64" rx="20"
      fill="none" stroke="${BLUE}" stroke-width="26"/>
    <!-- tote body, slightly tapered -->
    <path d="M112 216 L400 216 L378 396 A26 26 0 0 1 352 419 L160 419 A26 26 0 0 1 134 396 Z"
      fill="none" stroke="${BLUE}" stroke-width="26" stroke-linejoin="round"/>
    <!-- QR finder eye on the body -->
    <rect x="214" y="266" width="84" height="84" rx="14"
      fill="none" stroke="#ffffff" stroke-width="16"/>
    <rect x="242" y="294" width="28" height="28" rx="6" fill="#ffffff"/>
  </g>
</svg>`;
}

const outDir = join(import.meta.dir, "..", "public");
mkdirSync(outDir, { recursive: true });

async function png(svg: string, size: number, name: string) {
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .png()
    .toFile(join(outDir, name));
  console.log(`${name} (${size}x${size})`);
}

writeFileSync(join(outDir, "favicon.svg"), iconSvg(96));
console.log("favicon.svg");
await png(iconSvg(96), 192, "pwa-192x192.png");
await png(iconSvg(96), 512, "pwa-512x512.png");
await png(iconSvg(0, 0.78), 512, "maskable-icon-512x512.png");
await png(iconSvg(0), 180, "apple-touch-icon.png");
