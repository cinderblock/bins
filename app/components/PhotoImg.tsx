import { useEffect, useState } from "react";
import { getPhotoBlob } from "~/lib/photos";

/**
 * Object-URL lifecycle for a content-addressed photo. `hash` is the display
 * rendition (the canonical identity); pass `thumbHash` to render the small
 * rendition where available (strips, search) — it falls back to the display
 * image for old entries or not-yet-synced thumbs. `preferFull` forces the
 * display rendition even when a thumb exists.
 */
export function usePhotoUrl(
  hash: string | null,
  thumbHash?: string | null,
  preferFull = false,
) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hash) {
      setUrl(null);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    const wantThumb = !preferFull && !!thumbHash;
    void getPhotoBlob(
      wantThumb ? (thumbHash as string) : hash,
      wantThumb ? "thumb" : "display",
      wantThumb ? hash : null,
    ).then((blob) => {
      if (cancelled || !blob) return;
      revoked = URL.createObjectURL(blob);
      setUrl(revoked);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [hash, thumbHash, preferFull]);
  return url;
}

export function PhotoImg({
  hash,
  thumbHash,
  alt,
  preferFull,
  style,
}: {
  hash: string;
  thumbHash?: string | null;
  alt: string;
  preferFull?: boolean;
  style?: React.CSSProperties;
}) {
  const url = usePhotoUrl(hash, thumbHash, preferFull);
  if (!url) {
    return (
      <div
        style={{
          background: "var(--mantine-color-dark-5)",
          display: "grid",
          placeItems: "center",
          color: "var(--mantine-color-dark-2)",
          fontSize: 12,
          ...style,
        }}
      >
        …
      </div>
    );
  }
  return <img src={url} alt={alt} style={{ objectFit: "cover", ...style }} />;
}
