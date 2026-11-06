/**
 * What a device says about its own reports. The rule that matters: never claim
 * "fixed" on a build that doesn't have the fix yet.
 */
import { describe, expect, test } from "bun:test";
import { reportStep, type ServerReport } from "./reportStep";

const report = (over: Partial<ServerReport>): ServerReport => ({
  id: "a",
  text: "the button is hidden",
  status: "open",
  resolution: null,
  fixedInBuild: null,
  ...over,
});

describe("reportStep", () => {
  test("says when work starts, once", () => {
    const first = reportStep(
      { a: "open" },
      [report({ status: "working" })],
      "old",
      "old",
    );
    expect(first.say).toHaveLength(1);
    expect(first.tracked.a).toBe("working");

    const second = reportStep(
      first.tracked,
      [report({ status: "working" })],
      "old",
      "old",
    );
    expect(second.say).toHaveLength(0);
  });

  test("a fix this device doesn't have asks for an update and says nothing", () => {
    const step = reportStep(
      { a: "working" },
      [report({ status: "fixed", resolution: "Moved the button" })],
      "old",
      "new",
    );
    expect(step.needsUpdate).toBe(true);
    expect(step.say).toHaveLength(0);
    expect(step.tracked.a).toBe("working");
  });

  test("announces the fix once this device runs it, then stops tracking", () => {
    const step = reportStep(
      { a: "working" },
      [report({ status: "fixed", resolution: "Moved the button" })],
      "new",
      "new",
    );
    expect(step.needsUpdate).toBe(false);
    expect(step.say[0]?.message).toBe("Fixed: Moved the button");
    expect(step.tracked.a).toBeUndefined();
  });

  test("a device on a newer build than the fix still counts as fixed", () => {
    // Two fixes can land in one deploy, so compare with what the server runs
    // rather than with the commit the fix happened to be in.
    const step = reportStep(
      { a: "working" },
      [report({ status: "fixed", fixedInBuild: "older" })],
      "newest",
      "newest",
    );
    expect(step.say).toHaveLength(1);
  });

  test("says why when a report won't be fixed", () => {
    const step = reportStep(
      { a: "open" },
      [report({ status: "declined", resolution: "Needs a decision" })],
      "x",
      "x",
    );
    expect(step.say[0]?.message).toContain("Needs a decision");
    expect(step.tracked.a).toBeUndefined();
  });

  test("forgets a report the server no longer lists", () => {
    expect(reportStep({ a: "open" }, [], "x", "x").tracked.a).toBeUndefined();
  });
});
