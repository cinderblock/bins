/**
 * Label preview + print.
 *
 * Preview first, always. Printing commits physical stock, and generated art
 * costs real money per image — approving something you have not seen is how
 * both get wasted. The preview is the SAME render the printer receives, not an
 * approximation, so what you approve is what comes out.
 */
import {
  Alert,
  Button,
  Center,
  Group,
  Image,
  Loader,
  NumberInput,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconPrinter } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { apiFetch, apiJson } from "~/lib/api";

export function LabelPrintSheet({
  binId,
  adminPassword,
  artAvailable,
  content,
  opened,
  onClose,
}: {
  binId: number;
  adminPassword: string;
  /** An image provider is configured, so a drawing could be generated. */
  artAvailable: boolean;
  /**
   * What the label says, as the studio has it right now. Sent with every
   * request so the print never depends on the box row having synced.
   */
  content: { title: string; lines: string[]; labelArtHash: string | null };
  opened: boolean;
  onClose: () => void;
}) {
  const hasArt = content.labelArtHash !== null;
  // A box with a chosen drawing prints it by default; one without asks.
  //
  // DERIVED, not copied into state on mount: this sheet is mounted (closed)
  // as soon as the box exists, which in the new-box flow is BEFORE any
  // drawing has been made. A `useState(hasArt)` captured that early `false`
  // and only an effect put it right — so the first preview of a freshly
  // drawn box went out asking for no drawing at all. `null` here means
  // "nobody has touched the switch", and the answer follows the box.
  const [artChoice, setArtChoice] = useState<boolean | null>(null);
  const art = artChoice ?? hasArt;
  // Forget a deliberate choice between visits, so re-opening follows the box
  // again rather than a decision made about some earlier state of it.
  useEffect(() => {
    if (!opened) setArtChoice(null);
  }, [opened]);
  const [copies, setCopies] = useState<number | string>(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [artState, setArtState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  // Re-render whenever an option changes, so the preview never lags the
  // settings it claims to show. The subtext is compared by VALUE: the studio
  // rebuilds that array on every keystroke, and depending on its identity
  // re-fetched the preview for renders that changed nothing about it.
  const linesKey = content.lines.join("\n");
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    apiFetch("/api/admin/bins/label/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminPassword,
        binId,
        art,
        title: content.title,
        lines: linesKey ? linesKey.split("\n") : [],
        labelArtHash: content.labelArtHash,
      }),
    })
      .then(async (res) => ({
        blob: await res.blob(),
        art: res.headers.get("X-Bins-Label-Art"),
      }))
      .then(({ blob, art: state }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview(objectUrl);
        setArtState(state);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPreview(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      // Revoke on the way out or every preview leaks a blob for the life of
      // the page.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    opened,
    binId,
    adminPassword,
    art,
    content.title,
    linesKey,
    content.labelArtHash,
  ]);

  async function print() {
    setPrinting(true);
    try {
      const result = await apiJson<{
        printed: number;
        title: string;
        art: string;
      }>("/api/admin/bins/label", {
        method: "POST",
        body: JSON.stringify({
          adminPassword,
          binId,
          art,
          title: content.title,
          lines: content.lines,
          labelArtHash: content.labelArtHash,
          copies: Math.max(1, Math.min(Number(copies) || 1, 20)),
          // Printing what was previewed, not what the form might have
          // drifted to — same values, same picture.
        }),
      });
      notifications.show({
        message:
          result.art === "unavailable"
            ? `Printing ${result.printed} label${result.printed === 1 ? "" : "s"} for "${result.title}" — WITHOUT the drawing, which couldn't be found`
            : `Printing ${result.printed} label${result.printed === 1 ? "" : "s"} for "${result.title}"`,
        color: result.art === "unavailable" ? "orange" : "green",
      });
      onClose();
    } catch (err) {
      // The printer's own words — "out of paper" beats "print failed".
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setPrinting(false);
    }
  }

  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title="Print label">
      <Stack>
        <Center mih={220}>
          {loading ? (
            <Loader />
          ) : error ? (
            <Text c="red" size="sm" ta="center">
              {error}
            </Text>
          ) : preview ? (
            // Contained, not cropped: a preview that hides an edge is exactly
            // where a layout bug would hide too.
            <Image src={preview} alt="Label preview" fit="contain" mah={320} />
          ) : null}
        </Center>

        {/* The drawing was asked for and is not on this label. Loud, because
            the whole point of a preview is that you can trust it, and a
            missing picture is easy to miss on a small render. */}
        {artState === "unavailable" && (
          <Alert
            color="orange"
            variant="light"
            icon={<IconAlertTriangle size={16} />}
          >
            <Text size="sm">
              This box's drawing couldn't be found on the server, so the label
              above has none. Make a new one in the studio — printing now gives
              you a label without a picture.
            </Text>
          </Alert>
        )}

        {(artAvailable || hasArt) && (
          <Switch
            checked={art}
            onChange={(e) => setArtChoice(e.currentTarget.checked)}
            label={hasArt ? "Print the box's drawing" : "Add a drawing"}
            description={
              artState === "unavailable"
                ? "The chosen drawing is missing from the server, so this does nothing until a new one is made."
                : hasArt
                  ? "Already made — printing it costs nothing."
                  : "Generates one from the title. Costs a per-image fee; the same box reuses its picture rather than paying twice."
            }
          />
        )}

        <Group align="flex-end">
          <NumberInput
            label="Copies"
            min={1}
            max={20}
            value={copies}
            onChange={setCopies}
            w={110}
          />
          <Button
            flex={1}
            size="md"
            loading={printing}
            disabled={!preview || loading}
            leftSection={<IconPrinter size={18} />}
            onClick={() => void print()}
          >
            Print
          </Button>
        </Group>
      </Stack>
    </ResponsiveSheet>
  );
}
