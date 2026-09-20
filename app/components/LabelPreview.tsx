/**
 * A free, instant sketch of the label: what the title, subtext, drawing and
 * QR will roughly look like, redrawn on every keystroke without asking the
 * server for anything. The server's render (LabelPrintSheet) is the exact
 * image; this is the one you look at while typing.
 *
 * Mirrors api/labels/render.ts's proportions — landscape design space, title
 * across the top, lines under it, art filling the middle, QR bottom-left —
 * so what you see here is the same shape as what prints.
 */
import { Text } from "@mantine/core";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** 6 × 4 in, drawn at this width. */
const WIDTH = 360;
const HEIGHT = 240;

export function LabelPreview({
  title,
  lines,
  url,
  artUrl,
}: {
  title: string;
  lines: string[];
  /** What the QR encodes; null hides the QR (the `art` template). */
  url: string | null;
  artUrl: string | null;
}) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1 }).then(
      (data) => {
        if (!cancelled) setQr(data);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const shown = title.trim() || "Untitled box";
  // The renderer shrinks the headline to fit; approximate the same here so a
  // long name previews at roughly the size it will print.
  const fontSize = Math.max(14, Math.min(40, 460 / Math.max(shown.length, 6)));
  const qrSize = Math.round(HEIGHT * 0.42);

  return (
    <div
      aria-label="Label preview"
      style={{
        width: WIDTH,
        height: HEIGHT,
        maxWidth: "100%",
        background: "#fff",
        color: "#000",
        borderRadius: 6,
        padding: Math.round(WIDTH * 0.04),
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          fontSize,
          fontWeight: 700,
          lineHeight: 1.15,
          wordBreak: "break-word",
        }}
      >
        {shown}
      </div>
      {lines.length > 0 && (
        <div style={{ fontSize: 11, marginTop: 4, lineHeight: 1.3 }}>
          {lines.slice(0, 4).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 4,
        }}
      >
        {artUrl ? (
          <img
            src={artUrl}
            alt="Line drawing"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <div
            style={{
              width: "60%",
              height: "80%",
              border: "1px dashed #999",
              borderRadius: 4,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Text size="xs" c="dimmed">
              drawing
            </Text>
          </div>
        )}
      </div>
      {qr && (
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 2 }}>
          <img src={qr} alt="QR code" width={qrSize} height={qrSize} />
        </div>
      )}
    </div>
  );
}
