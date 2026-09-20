/**
 * A free, instant sketch of the label: what the title, subtext, drawing and
 * QR will roughly look like, redrawn on every keystroke without asking the
 * server for anything. The server's render (LabelPrintSheet) is the exact
 * image; this is the one you look at while typing.
 *
 * Mirrors api/labels/render.ts: landscape, tight padding, title across the
 * top, subtext then the QR down the left, the drawing filling everything to
 * the right of them.
 */
import { Text } from "@mantine/core";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** 6 × 4 in, drawn at this width. */
const WIDTH = 360;
const HEIGHT = 240;
/** The renderer's tenth-of-an-inch padding, at this scale. */
const PAD = 6;

export function LabelPreview({
  title,
  lines,
  url,
  artUrl,
}: {
  title: string;
  lines: string[];
  /** What the QR encodes; null draws a placeholder (box not yet allocated). */
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
    void QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 4 }).then(
      (data) => {
        if (!cancelled) setQr(data);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const shown = title.trim() || "Untitled box";
  // Half an inch at 203dpi is 101px on a 1218px-wide design; scaled here,
  // then shrunk for long names the way the renderer does.
  const base = Math.round(0.5 * (WIDTH / 6));
  const fontSize = Math.max(
    10,
    Math.min(base, 560 / Math.max(shown.length, 8)),
  );
  const qrSize = Math.round(HEIGHT * 0.36);
  const shownLines = lines.slice(0, 4);
  const leftWidth = Math.min(
    Math.max(
      qrSize,
      Math.ceil(Math.max(0, ...shownLines.map((l) => l.length)) * 5.5),
    ),
    Math.round((WIDTH - PAD * 2) * 0.45),
  );

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
        padding: PAD,
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
      <div style={{ display: "flex", flex: 1, minHeight: 0, marginTop: 2 }}>
        <div
          style={{
            width: leftWidth,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 10, lineHeight: 1.25 }}>
            {shownLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <div style={{ marginTop: "auto" }}>
            {qr ? (
              <img src={qr} alt="QR code" width={qrSize} height={qrSize} />
            ) : (
              <div
                style={{
                  width: qrSize,
                  height: qrSize,
                  border: "1px dashed #999",
                  borderRadius: 3,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Text size="xs" c="dimmed">
                  QR
                </Text>
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            marginLeft: PAD / 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
                width: "100%",
                height: "100%",
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
      </div>
    </div>
  );
}
