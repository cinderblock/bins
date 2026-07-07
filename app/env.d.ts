/** Vite `?url` asset imports not covered by vite/client's built-ins. */
declare module "*.wasm?url" {
  const src: string;
  export default src;
}
