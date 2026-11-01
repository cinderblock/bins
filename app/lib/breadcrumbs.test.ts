/**
 * The trail attached to reports. What matters most here is what stays out of
 * it: this text reaches the server, an agent and possibly a public commit.
 */
import { describe, expect, test } from "bun:test";
import { activityTrail, crumb, recordRequest, scrub } from "./breadcrumbs";

describe("scrub", () => {
  test("removes integration tokens and bearer headers", () => {
    expect(scrub("got bins_ab12cd34_0011223344 back")).toBe("got [token] back");
    expect(scrub("Authorization: Bearer abc.def")).toBe(
      "Authorization: Bearer [token]",
    );
  });

  test("removes the sticker code from a URL but keeps the path", () => {
    expect(scrub("opened https://x.example/123#7HX6")).toBe(
      "opened https://x.example/123#[code]",
    );
    expect(scrub("/join#s3cret-code")).toBe("/join#[code]");
  });

  test("removes known secrets, ignoring ones short enough to mangle text", () => {
    expect(scrub("the code is hunter22 ok", ["hunter22"])).toBe(
      "the code is [secret] ok",
    );
    expect(scrub("abc", ["a"])).toBe("abc");
  });
});

describe("trail", () => {
  test("crumbs are scrubbed and bounded", () => {
    for (let i = 0; i < 60; i++) crumb("tap", `button ${i}`);
    crumb("nav", "/10#7HX6");
    const { breadcrumbs } = activityTrail();
    expect(breadcrumbs).toHaveLength(40);
    expect(breadcrumbs.at(-1)?.detail).toBe("/10#[code]");
  });

  test("keeps failures, writes and slow calls, not routine reads", () => {
    recordRequest("GET", "/api/sync/pull?since=1", 200, 50);
    recordRequest("GET", "/api/bins?secret=1", 500, 50);
    recordRequest("POST", "/api/sync/push", 200, 50);
    recordRequest("GET", "/api/slow", 200, 5000);
    recordRequest("GET", "/api/down", "failed", 10);
    const details = activityTrail().requests.map((r) => r.detail);
    expect(details).toHaveLength(4);
    expect(details[0]).toBe("GET /api/bins 50ms");
  });
});
