/**
 * The ways into a report: a shake, the tab on the edge of the screen, and
 * `openReport()` from anywhere else.
 *
 * The tab sits on the left edge because every corner already belongs to a page
 * header or a fixed bottom bar. It also carries the agent's status, so a glance
 * says whether a report would be picked up.
 *
 * The page is captured before the sheet opens, since the sheet is what would
 * otherwise be in the picture.
 */
import { Button, Group, Image, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMessageReport, IconX } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { BUILD_SHA } from "~/lib/api";
import { REPORT_TAB_HIDDEN_KEY, SHAKE_KEY, db } from "~/lib/db";
import {
  type PageContext,
  REPORT_EVENT,
  capturePageContext,
  captureScreenshot,
  followReports,
  submitReport,
} from "~/lib/reports";
import { requestShakePermission, shakeSupport, watchShake } from "~/lib/shake";
import {
  AgentDot,
  AgentStatusLine,
  agentIsBusy,
  useAgentStatus,
} from "./AgentStatusLine";
import { ResponsiveSheet } from "./ResponsiveSheet";

export function ReportLauncher() {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState("");
  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const context = useRef<PageContext>({});
  const openedRef = useRef(false);
  openedRef.current = opened;
  const agent = useAgentStatus();

  const shakePref = useLiveQuery(
    async () => (await db.meta.get(SHAKE_KEY))?.value as string | undefined,
    [],
    undefined,
  );
  const tabHidden = useLiveQuery(
    async () => (await db.meta.get(REPORT_TAB_HIDDEN_KEY))?.value === true,
    [],
    false,
  );

  const open = useCallback(() => {
    if (openedRef.current) return;
    context.current = capturePageContext();
    void captureScreenshot().then((shot) => {
      setScreenshot(shot);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return shot ? URL.createObjectURL(shot) : null;
      });
    });
    setOpened(true);
  }, []);

  useEffect(() => {
    window.addEventListener(REPORT_EVENT, open);
    return () => window.removeEventListener(REPORT_EVENT, open);
  }, [open]);

  useEffect(() => {
    followReports(({ message, color }) =>
      notifications.show({ message, color, autoClose: 10_000 }),
    );
  }, []);

  useEffect(() => {
    const support = shakeSupport();
    if (support === "none" || shakePref === "off") return;
    if (support === "ready") return watchShake(open);
    if (shakePref !== "on") return;
    // iOS forgets the grant between launches and only asks from a tap, so the
    // first tap of a session renews it. Listening before that gets nothing.
    let stop = () => {};
    const renew = () => {
      void requestShakePermission().then((granted) => {
        if (granted) stop = watchShake(open);
      });
    };
    window.addEventListener("pointerup", renew, { once: true });
    return () => {
      window.removeEventListener("pointerup", renew);
      stop();
    };
  }, [shakePref, open]);

  function clearShot() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setScreenshot(null);
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    await submitReport({
      text: body,
      route: location.pathname,
      buildSha: BUILD_SHA,
      userAgent: navigator.userAgent.slice(0, 300),
      context: context.current,
      screenshot,
    });
    setText("");
    clearShot();
    setOpened(false);
    notifications.show({
      message: navigator.onLine
        ? "Report sent."
        : "Report saved. It'll send when you have signal.",
      color: "green",
    });
  }

  const showTab = !tabHidden || agentIsBusy(agent);

  return (
    <>
      {showTab && (
        <button
          type="button"
          className="report-tab"
          aria-label="Report a problem"
          onClick={open}
          style={{
            position: "fixed",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 190,
            display: "flex",
            alignItems: "center",
            gap: 4,
            minHeight: 56,
            padding: "0 5px",
            border: 0,
            borderRadius: "0 8px 8px 0",
            color: "var(--mantine-color-dimmed)",
            background: "var(--mantine-color-dark-5)",
            opacity: agentIsBusy(agent) ? 1 : 0.7,
          }}
        >
          <Stack gap={4} align="center">
            <IconMessageReport size={15} />
            <AgentDot agent={agent} />
          </Stack>
          {agentIsBusy(agent) && agent?.progress != null && (
            <Text size="xs" fw={600}>
              {Math.round(agent.progress * 100)}%
            </Text>
          )}
        </button>
      )}

      <ResponsiveSheet
        opened={opened}
        onClose={() => setOpened(false)}
        title="Report a problem"
        dismissLabel={null}
        screenshotIgnored
      >
        <Stack gap="sm">
          <AgentStatusLine />
          <Textarea
            data-autofocus
            aria-label="What's wrong?"
            placeholder="What's wrong, or what should it do?"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={3}
            maxRows={8}
            maxLength={4000}
          />
          {preview && (
            <Group gap="xs" wrap="nowrap">
              <Image
                src={preview}
                alt="Screenshot of the page"
                h={72}
                w="auto"
                radius="sm"
              />
              <Button
                variant="subtle"
                size="xs"
                color="gray"
                leftSection={<IconX size={14} />}
                onClick={clearShot}
              >
                Leave out
              </Button>
            </Group>
          )}
          <Button fullWidth disabled={!text.trim()} onClick={() => void send()}>
            Send
          </Button>
        </Stack>
      </ResponsiveSheet>
    </>
  );
}
