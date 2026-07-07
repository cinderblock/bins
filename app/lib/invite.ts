/**
 * Invite links. A second device joins with the group access code at /join; an
 * invite link just carries that code in the URL fragment (#… — never sent to
 * the server, same log-hygiene reason as sticker secrets) so the recipient only
 * types their name. We cache the plaintext code on the devices that already
 * know it — they set the group up, joined with it, or rotated it — so the
 * operator always has a ready-to-share link. Sticker-joined devices never learn
 * the code; they can type it once in Settings to enable the link.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { ACCESS_CODE_KEY, getMeta, setMeta } from "./db";

export async function rememberAccessCode(code: string): Promise<void> {
  const trimmed = code.trim();
  if (trimmed) await setMeta(ACCESS_CODE_KEY, trimmed);
}

/** Reactive cached access code: undefined = loading, null = unknown here. */
export function useAccessCode(): string | null | undefined {
  return useLiveQuery(
    async () => (await getMeta<string>(ACCESS_CODE_KEY)) ?? null,
    [],
    undefined,
  );
}

/** The shareable join link for a code, derived from the serving origin. */
export function inviteLink(code: string): string {
  return `${window.location.origin}/join#${encodeURIComponent(code)}`;
}
