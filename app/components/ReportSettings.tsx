/** Reporting, per device: shake on or off, and the tab on the screen's edge. */
import { Button, Paper, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useLiveQuery } from "dexie-react-hooks";
import { REPORT_TAB_HIDDEN_KEY, SHAKE_KEY, db, setMeta } from "~/lib/db";
import { openReport } from "~/lib/reports";
import { requestShakePermission, shakeSupport } from "~/lib/shake";
import { AgentStatusLine } from "./AgentStatusLine";

export function ReportSettings() {
  const support = shakeSupport();
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
  // On unless turned off, except on iOS, which has to be asked first.
  const shakeOn =
    shakePref === "on" || (support === "ready" && shakePref !== "off");

  async function setShake(on: boolean) {
    if (on && !(await requestShakePermission())) {
      notifications.show({
        message: "Motion access was refused, so shake can't work here.",
        color: "yellow",
      });
      return;
    }
    await setMeta(SHAKE_KEY, on ? "on" : "off");
  }

  return (
    <Paper p="md" radius="lg" withBorder>
      <Stack gap="sm">
        <Text fw={600}>Report a problem</Text>
        <AgentStatusLine />
        {support !== "none" && (
          <Switch
            label="Shake to report"
            checked={shakeOn}
            onChange={(e) => void setShake(e.currentTarget.checked)}
          />
        )}
        <Switch
          label="Show the report tab on the screen's edge"
          checked={!tabHidden}
          onChange={(e) =>
            void setMeta(REPORT_TAB_HIDDEN_KEY, !e.currentTarget.checked)
          }
        />
        <Button variant="default" onClick={openReport}>
          Report a problem
        </Button>
      </Stack>
    </Paper>
  );
}
