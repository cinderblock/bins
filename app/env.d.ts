/**
 * The commit this bundle was built from, replaced at build time by Vite's
 * `define` (see vite.config.ts). Declared, not imported, so it inlines to a
 * literal and costs nothing at runtime.
 */
declare const __BUILD_SHA__: string;

/** Vite `?url` asset imports not covered by vite/client's built-ins. */
declare module "*.wasm?url" {
  const src: string;
  export default src;
}
