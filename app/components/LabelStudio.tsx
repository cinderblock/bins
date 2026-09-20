/**
 * The label-first way to set up a box.
 *
 * Modelled on a label generator, because that is what making a box actually
 * is: decide what the sticker will say (title, subtext), what it will show
 * (a line drawing, guided by a sentence and a few reference pictures), see
 * it as you type, and print. The rest — size, categories, how full — sits
 * on the same screen so a box is described once, at the desk, while it is
 * open in front of you.
 *
 * Generating never blocks: every tap is another candidate, side by side,
 * and the one you tap is the one the box keeps. The chosen picture lives on
 * the box (labelArtHash), so a reprint months from now is free and identical.
 *
 * Two modes, one component: `new` sets up a freshly allocated box (its first
 * save is the claim); `edit` revisits an existing one from the Label button.
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  FileButton,
  Group,
  Image,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { BinFields } from "@shared/ops";
import type { BinState } from "@shared/reducer";
import {
  IconInfoCircle,
  IconPhotoUp,
  IconPrinter,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { FillLevelInput } from "~/components/FillLevel";
import { LabelChips } from "~/components/LabelChips";
import { LabelPreview } from "~/components/LabelPreview";
import { LabelPrintSheet } from "~/components/LabelSheet.print";
import { SizePicker } from "~/components/SizePicker";
import { WeightInput } from "~/components/WeightInput";
import { claimBin, setBinFields, setBinLabel } from "~/lib/actions";
import { boxPath, useBoxNumbersInternal } from "~/lib/boxRef";
import { useBoxSizes } from "~/lib/boxSizes";
import { useDeployment } from "~/lib/deployment";
import {
  type ArtReference,
  type ArtStatus,
  fetchArtStatus,
  formatUsd,
  generateLabelArt,
  makeReference,
} from "~/lib/labelArt";
import { syncNow } from "~/lib/sync";

type Candidate = {
  id: string;
  status: "pending" | "done" | "failed";
  hash: string | null;
  dataUrl: string | null;
  error: string | null;
  model: string;
};

const MAX_REFERENCES = 5;

export function LabelStudio({
  bin,
  mode,
  adminPassword,
  onDone,
}: {
  bin: BinState;
  mode: "new" | "edit";
  adminPassword: string;
  onDone: () => void;
}) {
  const sizes = useBoxSizes();
  const deployment = useDeployment();
  const numbersInternal = useBoxNumbersInternal();

  // --- what the box says ---------------------------------------------------
  const [name, setName] = useState(bin.name ?? "");
  const [description, setDescription] = useState(bin.description ?? "");
  const [sizeId, setSizeId] = useState<string | null>(bin.sizeId);
  const [labels, setLabels] = useState<Set<string>>(new Set(bin.labelIds));
  const [fillLevel, setFillLevel] = useState<number | null>(bin.fillLevel);
  const [weightGrams, setWeightGrams] = useState<number | null>(
    bin.weightGrams,
  );

  // --- what it shows -------------------------------------------------------
  const [artPrompt, setArtPrompt] = useState(bin.artPrompt ?? "");
  const [references, setReferences] = useState<ArtReference[]>([]);
  const [art, setArt] = useState<ArtStatus | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosenHash, setChosenHash] = useState<string | null>(bin.labelArtHash);
  const [chosenUrl, setChosenUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  // In `new` mode the first save is the claim; after that, ordinary edits.
  const claimedRef = useRef(mode === "edit" || bin.status !== "unclaimed");
  // What was last written, so a flush only sends what changed since.
  const writtenRef = useRef<BinFields>({
    name: bin.name,
    description: bin.description,
    sizeId: bin.sizeId,
    fillLevel: bin.fillLevel,
    weightGrams: bin.weightGrams,
    artPrompt: bin.artPrompt,
    labelArtHash: bin.labelArtHash,
  });
  const writtenLabelsRef = useRef<Set<string>>(new Set(bin.labelIds));

  useEffect(() => {
    let cancelled = false;
    fetchArtStatus(adminPassword)
      .then((status) => {
        if (cancelled) return;
        setArt(status);
        setModel((m) => m ?? status.defaultModel);
      })
      .catch(() => {
        if (!cancelled) setArt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [adminPassword]);

  // The chosen picture, for the live preview: from this session's
  // candidates when it was just made, else from the local blob cache.
  useEffect(() => {
    if (!chosenHash) {
      setChosenUrl(null);
      return;
    }
    const fresh = candidates.find((c) => c.hash === chosenHash)?.dataUrl;
    if (fresh) {
      setChosenUrl(fresh);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    void import("~/lib/photos").then(({ getPhotoBlob }) =>
      getPhotoBlob(chosenHash, "display").then((blob) => {
        if (cancelled || !blob) return;
        revoked = URL.createObjectURL(blob);
        setChosenUrl(revoked);
      }),
    );
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [chosenHash, candidates]);

  function currentFields(): BinFields {
    return {
      name: name.trim() || null,
      description: description.trim() || null,
      sizeId,
      fillLevel,
      weightGrams,
      artPrompt: artPrompt.trim() || null,
      labelArtHash: chosenHash,
    };
  }

  /**
   * Write everything that changed. The first write of a new box is its
   * claim; every later write is a setFields carrying only changed keys, so
   * a field left alone can never clobber another device's newer value.
   */
  async function flush(): Promise<void> {
    const next = currentFields();
    if (!claimedRef.current) {
      await claimBin(bin.id, next);
      claimedRef.current = true;
      writtenRef.current = next;
      for (const id of labels) await setBinLabel(bin.id, id, true);
      writtenLabelsRef.current = new Set(labels);
      return;
    }
    const changed: BinFields = {};
    for (const key of Object.keys(next) as (keyof BinFields)[]) {
      if (next[key] !== writtenRef.current[key]) {
        // biome-ignore lint/suspicious/noExplicitAny: same key both sides
        (changed as any)[key] = next[key];
      }
    }
    if (Object.keys(changed).length > 0) {
      await setBinFields(bin.id, changed);
      writtenRef.current = { ...writtenRef.current, ...changed };
    }
    for (const id of labels)
      if (!writtenLabelsRef.current.has(id))
        await setBinLabel(bin.id, id, true);
    for (const id of writtenLabelsRef.current)
      if (!labels.has(id)) await setBinLabel(bin.id, id, false);
    writtenLabelsRef.current = new Set(labels);
  }

  function toggleLabel(labelId: string, present: boolean) {
    setLabels((prev) => {
      const next = new Set(prev);
      if (present) next.add(labelId);
      else next.delete(labelId);
      return next;
    });
  }

  async function addReferences(files: File[]) {
    const room = MAX_REFERENCES - references.length;
    const picked = files.slice(0, Math.max(0, room));
    const made: ArtReference[] = [];
    for (const file of picked) {
      try {
        made.push(await makeReference(file));
      } catch {
        notifications.show({
          message: `Couldn't read ${file.name}`,
          color: "red",
        });
      }
    }
    setReferences((prev) => [...prev, ...made].slice(0, MAX_REFERENCES));
  }

  /**
   * Another candidate. Never disabled while one is in flight: each tap is a
   * separate job with its own nonce, so the results are different pictures
   * and the person picks. The box's fields are flushed and synced first,
   * because the server draws from what the BOX says, not from this form.
   */
  async function generate() {
    if (!name.trim()) {
      notifications.show({ message: "Give the box a title first" });
      return;
    }
    const id = crypto.randomUUID();
    const chosenModel = model ?? art?.defaultModel ?? "";
    setCandidates((prev) => [
      ...prev,
      {
        id,
        status: "pending",
        hash: null,
        dataUrl: null,
        error: null,
        model: chosenModel,
      },
    ]);
    try {
      await flush();
      await syncNow();
      const result = await generateLabelArt(adminPassword, bin.id, {
        model: chosenModel,
        instructions: artPrompt.trim() || null,
        references,
        nonce: id,
      });
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "done",
                hash: result.hash,
                dataUrl: result.dataUrl,
              }
            : c,
        ),
      );
      setArt((prev) =>
        prev
          ? { ...prev, spentUsd: result.spentUsd, budgetUsd: result.budgetUsd }
          : prev,
      );
      // The first picture becomes the label's picture without a further tap;
      // a later one replaces it only when tapped.
      setChosenHash((current) => current ?? result.hash);
    } catch (err) {
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              }
            : c,
        ),
      );
    }
  }

  async function save(then: "done" | "print") {
    setSaving(true);
    try {
      await flush();
      if (then === "print") {
        await syncNow();
        setPrintOpen(true);
      } else {
        notifications.show({
          message: mode === "new" ? "Box set up" : "Saved",
          color: "green",
        });
        onDone();
      }
    } catch (err) {
      notifications.show({
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const previewPath = boxPath(bin, numbersInternal);
  const previewUrl = (
    bin.secretCode
      ? `${origin}${previewPath}#${bin.secretCode}`
      : `${origin}${previewPath}`
  ).toUpperCase();
  const lines = description
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const canPrint = deployment?.labelPrinting === true;
  const modelInfo = art?.models.find((m) => m.id === model);
  const pending = candidates.filter((c) => c.status === "pending").length;

  return (
    <Stack gap="md">
      <TextInput
        label="Title"
        description="Large text at the top — it also tells the drawing what to draw."
        placeholder="e.g. USB cables"
        size="lg"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        autoFocus={mode === "new"}
      />
      <Textarea
        label="Subtext"
        description="A few short lines under the title."
        placeholder={"e.g. USB-A to USB-C\nData cables\nVarious lengths"}
        autosize
        minRows={2}
        maxRows={4}
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
      />

      <Center>
        <LabelPreview
          title={name}
          lines={lines}
          url={previewUrl}
          artUrl={chosenUrl}
        />
      </Center>

      {art?.available ? (
        <Paper p="sm" radius="md" withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Line drawing
              </Text>
              {art.budgetUsd != null ? (
                <Text size="xs" c="dimmed">
                  {formatUsd(Math.max(0, art.budgetUsd - art.spentUsd))} left
                  this month
                </Text>
              ) : (
                <Text size="xs" c="dimmed">
                  {formatUsd(art.spentUsd)} spent this month
                </Text>
              )}
            </Group>
            <Textarea
              label="Extra instructions (optional)"
              placeholder="e.g. show different connector types, include a coiled cable"
              autosize
              minRows={1}
              maxRows={3}
              value={artPrompt}
              onChange={(e) => setArtPrompt(e.currentTarget.value)}
            />
            <div>
              <Text size="sm" fw={500} mb={4}>
                Reference pictures (optional)
              </Text>
              <Group gap="xs">
                {references.map((ref, i) => (
                  <div
                    key={ref.data.slice(0, 32)}
                    style={{ position: "relative" }}
                  >
                    <Image
                      src={ref.previewUrl}
                      alt={`Reference ${i + 1}`}
                      w={56}
                      h={56}
                      radius="sm"
                      fit="cover"
                    />
                    <ActionIcon
                      size="xs"
                      radius="xl"
                      variant="filled"
                      color="gray"
                      aria-label="Remove reference"
                      style={{ position: "absolute", top: -6, right: -6 }}
                      onClick={() =>
                        setReferences((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  </div>
                ))}
                {references.length < MAX_REFERENCES && (
                  <FileButton
                    onChange={(files) => void addReferences(files)}
                    accept="image/*"
                    multiple
                  >
                    {(props) => (
                      <Button
                        {...props}
                        variant="default"
                        size="sm"
                        leftSection={<IconPhotoUp size={16} />}
                      >
                        Add pictures
                      </Button>
                    )}
                  </FileButton>
                )}
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Style hints for the drawing, not stored on the box.
              </Text>
            </div>
            <Group justify="space-between" align="flex-end">
              <div>
                <Text size="xs" c="dimmed" mb={2}>
                  Model
                </Text>
                <SegmentedControl
                  size="xs"
                  value={model ?? art.defaultModel}
                  onChange={setModel}
                  data={art.models.map((m) => ({
                    value: m.id,
                    label: `${m.label} · ${formatUsd(m.usd)}`,
                  }))}
                />
              </div>
              <Button
                leftSection={<IconSparkles size={16} />}
                rightSection={
                  modelInfo ? (
                    <Badge size="xs" variant="light" color="gray">
                      {formatUsd(modelInfo.usd)}
                    </Badge>
                  ) : undefined
                }
                onClick={() => void generate()}
                disabled={!name.trim()}
              >
                {candidates.length === 0 ? "Generate" : "Another one"}
              </Button>
            </Group>
            {pending > 0 && (
              <Text size="xs" c="dimmed">
                {pending} drawing{pending === 1 ? "" : "s"} on the way…
              </Text>
            )}
            {candidates.length > 0 && (
              <Group gap="xs">
                {candidates.map((c) => (
                  <UnstyledButton
                    key={c.id}
                    disabled={c.status !== "done"}
                    onClick={() => c.hash && setChosenHash(c.hash)}
                    aria-label={
                      c.status === "done"
                        ? "Use this drawing"
                        : c.status === "failed"
                          ? `Failed: ${c.error}`
                          : "Drawing in progress"
                    }
                    style={{
                      width: 96,
                      height: 72,
                      borderRadius: 6,
                      background: "#fff",
                      display: "grid",
                      placeItems: "center",
                      overflow: "hidden",
                      border: `2px solid ${
                        c.hash && c.hash === chosenHash
                          ? "var(--mantine-primary-color-filled)"
                          : "var(--mantine-color-default-border)"
                      }`,
                    }}
                  >
                    {c.status === "pending" && <Loader size="sm" />}
                    {c.status === "failed" && (
                      <Text size="xs" c="red" ta="center" px={4}>
                        failed
                      </Text>
                    )}
                    {c.status === "done" && c.dataUrl && (
                      <img
                        src={c.dataUrl}
                        alt="Candidate drawing"
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                        }}
                      />
                    )}
                  </UnstyledButton>
                ))}
              </Group>
            )}
            {candidates.some((c) => c.status === "failed") && (
              <Text size="xs" c="red">
                {candidates.find((c) => c.status === "failed")?.error}
              </Text>
            )}
          </Stack>
        </Paper>
      ) : (
        art !== null && (
          <Alert
            variant="light"
            color="gray"
            icon={<IconInfoCircle size={16} />}
            p="xs"
          >
            <Text size="xs">
              Drawings are off on this deployment (no image provider
              configured). Labels print with the title, subtext and QR.
            </Text>
          </Alert>
        )
      )}

      <Divider label="About the box" labelPosition="center" />
      <SizePicker sizes={sizes} value={sizeId} onChange={setSizeId} />
      <div>
        <Text size="sm" fw={500} mb={4}>
          Categories
        </Text>
        <LabelChips selected={labels} onToggle={toggleLabel} />
      </div>
      <FillLevelInput value={fillLevel} onChange={setFillLevel} />
      <WeightInput grams={weightGrams} onChange={setWeightGrams} />

      <Group grow>
        <Button
          size="lg"
          variant={canPrint ? "light" : "filled"}
          loading={saving}
          onClick={() => void save("done")}
        >
          {mode === "new" ? "Save box" : "Save"}
        </Button>
        {canPrint && (
          <Button
            size="lg"
            leftSection={<IconPrinter size={18} />}
            loading={saving}
            disabled={!name.trim()}
            onClick={() => void save("print")}
          >
            Print label
          </Button>
        )}
      </Group>

      <LabelPrintSheet
        binId={bin.id}
        adminPassword={adminPassword}
        artAvailable={art?.available === true}
        hasArt={chosenHash !== null}
        opened={printOpen}
        onClose={() => {
          setPrintOpen(false);
          onDone();
        }}
      />
    </Stack>
  );
}
