import { useEffect, useState } from "react";
import { getPhotoBlob } from "~/lib/photos";

/** Object-URL lifecycle for a content-addressed photo. */
export function usePhotoUrl(hash: string | null, preferFull = false) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hash) {
      setUrl(null);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    void getPhotoBlob(hash, preferFull).then((blob) => {
      if (cancelled || !blob) return;
      revoked = URL.createObjectURL(blob);
      setUrl(revoked);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [hash, preferFull]);
  return url;
}

export function PhotoImg({
  hash,
  alt,
  preferFull,
  style,
}: {
  hash: string;
  alt: string;
  preferFull?: boolean;
  style?: React.CSSProperties;
}) {
  const url = usePhotoUrl(hash, preferFull);
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
