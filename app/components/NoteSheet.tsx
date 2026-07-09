/**
 * Quick note bottom sheet. Voice-to-text strategy: the auto-focused textarea
 * summons the keyboard, whose built-in dictation mic works on-device and
 * offline on both platforms — better than a custom Web Speech feature. On
 * Android (where SpeechRecognition is reliable) an optional mic streams
 * interim results in as a progressive enhancement.
 */
import { ActionIcon, Button, Group, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMicrophone, IconMicrophoneOff } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { addNote } from "~/lib/actions";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
};

function speechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor || !navigator.onLine) return null;
  // iOS Safari nominally has this but it is unreliable in installed PWAs —
  // the keyboard mic is the iOS path.
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return null;
  return new Ctor();
}

export function NoteSheet({
  binId,
  opened,
  onClose,
}: {
  binId: number;
  opened: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const [micAvailable, setMicAvailable] = useState(false);

  useEffect(() => {
    if (opened) setMicAvailable(speechRecognition() !== null);
    else stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  function stopListening() {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }

  function toggleMic() {
    if (listening) {
      stopListening();
      return;
    }
    const rec = speechRecognition();
    if (!rec) return;
    baseRef.current = text ? `${text} ` : "";
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (event) => {
      const transcript = Array.from(
        { length: event.results.length },
        (_, i) => event.results[i]?.[0]?.transcript ?? "",
      ).join("");
      setText(baseRef.current + transcript);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function save() {
    const trimmed = text.trim();
    if (!trimmed) return;
    stopListening();
    await addNote(binId, trimmed);
    notifications.show({ message: "Note saved", color: "green" });
    setText("");
    onClose();
  }

  return (
    <ResponsiveSheet
      opened={opened}
      onClose={() => {
        stopListening();
        onClose();
      }}
      title="What's in here?"
    >
      <Textarea
        data-autofocus
        placeholder="e.g. 3 tarps, camp stove, the good scissors"
        autosize
        minRows={3}
        maxRows={8}
        size="lg"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        rightSection={
          micAvailable ? (
            <ActionIcon
              variant={listening ? "filled" : "subtle"}
              color={listening ? "red" : "gray"}
              onClick={toggleMic}
              aria-label="Dictate"
            >
              {listening ? (
                <IconMicrophoneOff size={18} />
              ) : (
                <IconMicrophone size={18} />
              )}
            </ActionIcon>
          ) : undefined
        }
      />
      <Group justify="flex-end" mt="md" pb="env(safe-area-inset-bottom)">
        <Button size="lg" onClick={() => void save()} disabled={!text.trim()}>
          Save note
        </Button>
      </Group>
    </ResponsiveSheet>
  );
}
