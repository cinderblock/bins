/**
 * The classifier's guard rails.
 *
 * Almost everything here is about Jev DECLINING. Its value over a generative
 * model is that it reports when it does not know, so the paths that turn a
 * weak answer into no answer are the ones worth pinning down — a threshold
 * that silently stopped applying would look exactly like a confident router
 * and be wrong a tenth of the time.
 *
 * No network: `fetch` is stubbed, so these run anywhere and cost nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CatalogBin, CatalogData } from "../ai/catalog";
import { JEV_MIN_CONFIDENCE, askJev, jevAvailable } from "./client";
import { verifyFit } from "./fit";
import { routeIntent } from "./intent";
import { lexicalShortlist, rankCandidates } from "./shortlist";
import { JevError, JevUnavailableError } from "./types";

process.env.AI_SPEND_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "data",
  "test-jev",
);

const realFetch = globalThis.fetch;
let calls: { body: unknown }[] = [];

/** Reply with a fixed body, or a status, for the next call(s). */
function stub(responses: (unknown | { status: number })[]) {
  let i = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next && typeof next === "object" && "status" in next) {
      return new Response("nope", {
        status: (next as { status: number }).status,
      });
    }
    return new Response(JSON.stringify(next), { status: 200 });
  }) as unknown as typeof fetch;
}

function choice(
  value: string,
  confidence: number,
  probabilities?: Record<string, number>,
) {
  return {
    model: "jev-1.13.0",
    answers: {
      intent: {
        type: "choice",
        choice: value,
        confidence,
        probabilities: probabilities ?? { [value]: confidence },
      },
      box: {
        type: "choice",
        choice: value,
        confidence,
        probabilities: probabilities ?? { [value]: confidence },
      },
    },
    usage: { input_tokens: 300 },
  };
}

beforeEach(() => {
  process.env.TYPESAFE_AI_API_KEY = "test-key";
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.TYPESAFE_AI_API_KEY = undefined;
});

describe("availability", () => {
  test("no key means the feature is simply off", async () => {
    process.env.TYPESAFE_AI_API_KEY = "";
    expect(jevAvailable()).toBe(false);
    expect(askJev("t", "x", {})).rejects.toBeInstanceOf(JevUnavailableError);
  });
});

describe("response validation", () => {
  test("an unexpected shape is rejected rather than half-read", async () => {
    // Typed at the source or not, a missing `confidence` would silently
    // disable the threshold everything else here depends on.
    stub([
      {
        model: "jev-1.13.0",
        answers: { intent: { type: "choice", choice: "find" } },
      },
    ]);
    expect(
      askJev("t", "x", {
        intent: { type: "choice", instructions: "", criteria: {} },
      }),
    ).rejects.toBeInstanceOf(JevError);
  });

  test("bills input tokens at the documented rate", async () => {
    stub([choice("find", 0.9)]);
    const r = await askJev("t", "x", {
      intent: { type: "choice", instructions: "", criteria: {} },
    });
    // 300 tokens at $0.042/M.
    expect(r.costUsd).toBeCloseTo((300 * 0.042) / 1_000_000, 12);
  });

  test("retries a 429 and gives up on a 422", async () => {
    stub([{ status: 429 }, choice("find", 0.9)]);
    await askJev("t", "x", {
      intent: { type: "choice", instructions: "", criteria: {} },
    });
    expect(calls).toHaveLength(2);

    calls = [];
    stub([{ status: 422 }]);
    expect(
      askJev("t", "x", {
        intent: { type: "choice", instructions: "", criteria: {} },
      }),
    ).rejects.toBeInstanceOf(JevError);
    expect(calls).toHaveLength(1);
  });
});

describe("routeIntent", () => {
  test("routes when confident", async () => {
    stub([choice("find", 0.96)]);
    expect(await routeIntent("extension cords")).toEqual({
      kind: "find",
      confidence: 0.96,
    });
  });

  test("declines below the threshold rather than guessing", async () => {
    // The measured case: "new box of drill bits" is genuinely ambiguous
    // English and Jev scored it 0.05-0.07, flipping its answer between runs.
    stub([choice("find", JEV_MIN_CONFIDENCE - 0.01)]);
    expect(await routeIntent("new box of drill bits")).toBeNull();
  });

  test("declines on an option it was never offered", async () => {
    stub([choice("something-else", 0.99)]);
    expect(await routeIntent("x")).toBeNull();
  });

  test("never throws — a broken router must not break the search box", async () => {
    stub([{ status: 500 }]);
    expect(await routeIntent("x")).toBeNull();
    process.env.TYPESAFE_AI_API_KEY = "";
    expect(await routeIntent("x")).toBeNull();
  });
});

describe("verifyFit", () => {
  const candidates = [
    {
      id: 12,
      name: "Power cables",
      description: "extension cords",
      fillLevel: 90,
      size: null,
    },
  ];

  function noul(p: number) {
    return {
      model: "jev-1.13.0",
      answers: { fits: { type: "noul", noul: p } },
      usage: { input_tokens: 200 },
    };
  }

  test("a low probability means start a new box", async () => {
    stub([noul(0.08)]);
    expect(await verifyFit("a garden hose", candidates)).toEqual({
      probability: 0.08,
      newBox: true,
    });
  });

  test("a high probability means use what is there", async () => {
    stub([noul(0.97)]);
    expect(await verifyFit("an IEC lead", candidates)).toEqual({
      probability: 0.97,
      newBox: false,
    });
  });

  test("with no candidates there is no question to ask", async () => {
    stub([noul(0.5)]);
    expect(await verifyFit("anything", [])).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("states fullness explicitly — it is what the answer turns on", async () => {
    stub([noul(0.5)]);
    await verifyFit("x", candidates);
    expect(String((calls[0]?.body as { state: string }).state)).toContain(
      "90% full",
    );
  });
});

function bin(id: number, name: string, description = ""): CatalogBin {
  return {
    id,
    status: "active",
    name,
    description,
    labelIds: null,
    locationId: null,
    locationName: null,
    slot: null,
    sizeId: null,
    sizeClass: null,
    fillLevel: null,
    weightGrams: null,
    primaryPhotoHash: null,
  };
}

const DATA: CatalogData = {
  bins: [
    bin(10, "Power cables", "extension cords"),
    bin(11, "Stationery", "pens and sticky notes"),
    bin(12, "Retired thing", "old junk"),
  ],
  notesByBin: new Map([[11, ["the sharpies live in here"]]]),
  describedByBin: new Map([[10, ["IEC leads"]]]),
  labels: [],
  sizes: [],
  places: [],
};
DATA.bins[2] = { ...(DATA.bins[2] as CatalogBin), status: "retired" };

describe("lexicalShortlist", () => {
  test("matches on a note, which is often the only place a word appears", () => {
    expect(lexicalShortlist(DATA, "sharpies").map((b) => b.id)).toEqual([11]);
  });

  test("matches on what a model read off the photo", () => {
    expect(lexicalShortlist(DATA, "IEC").map((b) => b.id)).toEqual([10]);
  });

  test("never proposes a box that is not active", () => {
    expect(lexicalShortlist(DATA, "junk")).toHaveLength(0);
  });
});

describe("rankCandidates", () => {
  const candidates = [DATA.bins[0] as CatalogBin, DATA.bins[1] as CatalogBin];

  test("orders by probability, best first", async () => {
    stub([choice("11", 0.9, { "11": 0.9, "10": 0.1, none: 0 })]);
    const ranked = await rankCandidates("sharpies", candidates, DATA);
    expect(ranked?.map((r) => r.id)).toEqual([11, 10]);
  });

  test("declining is an answer — the caller keeps the full catalog", async () => {
    // Forcing a pick from a list that does not contain the thing is exactly
    // how a shortlist quietly hides the right box.
    stub([choice("none", 0.95, { none: 0.95, "10": 0.05 })]);
    expect(await rankCandidates("a kayak paddle", candidates, DATA)).toBeNull();
  });

  test("low confidence also declines", async () => {
    stub([choice("10", JEV_MIN_CONFIDENCE - 0.05, { "10": 0.3, "11": 0.3 })]);
    expect(await rankCandidates("something", candidates, DATA)).toBeNull();
  });

  test("offers a 'none' option at all — without it there is no way to decline", async () => {
    stub([choice("10", 0.9)]);
    await rankCandidates("x", candidates, DATA);
    const body = calls[0]?.body as {
      questions: { box: { criteria: Record<string, string> } };
    };
    expect(Object.keys(body.questions.box.criteria)).toContain("none");
  });
});
