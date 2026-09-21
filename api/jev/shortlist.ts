/**
 * Narrowing the catalog before the expensive model sees it.
 *
 * The assistant's prompt carries every active box — tens of thousands of
 * tokens — because a generative model has no way to ask "which of these
 * matter?" without reading all of them first. A classifier does: a cheap
 * lexical pass proposes a few dozen candidates, Jev says which of those
 * plausibly hold the thing, and only the survivors go into the prompt.
 *
 * The output shape does not change. The answer still comes back as prose
 * with reasons, because that is what is readable standing at a shelf — this
 * only changes how much the model had to read to write it.
 *
 * It is allowed to decline. If the lexical pass finds nothing, or Jev says
 * none of the candidates fit, or it is not confident, the caller keeps the
 * full catalog — a shortlist that quietly drops the right box is far worse
 * than a prompt that costs more.
 */
import MiniSearch from "minisearch";
import type { CatalogBin, CatalogData } from "../ai/catalog";
import { JEV_MIN_CONFIDENCE, askJev } from "./client";
import { type JevChoiceQuestion, JevUnavailableError } from "./types";

/**
 * How many boxes the lexical pass proposes. Comfortably under Jev's 255
 * option cap, and wide enough that a fuzzy match on a misspelling still has
 * room to appear before the classifier judges it.
 */
export const LEXICAL_CANDIDATES = 40;

/** The escape hatch, so "none of these" is an answer rather than a bad pick. */
const NONE = "none";

type Doc = {
  id: number;
  text: string;
};

/** Everything about a box that someone might type, flattened into one field. */
function docFor(
  bin: CatalogBin,
  labelNames: ReadonlyMap<string, string>,
  notes: readonly string[],
  described: readonly string[],
): Doc {
  return {
    id: bin.id,
    text: [
      bin.name ?? "",
      bin.description ?? "",
      ...(bin.labelIds ?? []).map((id) => labelNames.get(id) ?? ""),
      ...notes,
      ...described,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * A cheap first pass over the catalog.
 *
 * The same MiniSearch the phones already run offline, for the same reason:
 * prefix and fuzzy matching means a misspelling still proposes the right box
 * rather than dropping it before anything smarter gets a look.
 */
export function lexicalShortlist(
  data: CatalogData,
  query: string,
  limit = LEXICAL_CANDIDATES,
): CatalogBin[] {
  const labelNames = new Map(data.labels.map((l) => [l.id, l.name]));
  const active = data.bins.filter((bin) => bin.status === "active");
  const index = new MiniSearch<Doc>({
    fields: ["text"],
    searchOptions: { prefix: true, fuzzy: 0.2 },
  });
  index.addAll(
    active.map((bin) =>
      docFor(
        bin,
        labelNames,
        data.notesByBin.get(bin.id) ?? [],
        data.describedByBin.get(bin.id) ?? [],
      ),
    ),
  );
  const byId = new Map(active.map((bin) => [bin.id, bin]));
  const hits = index.search(query).slice(0, limit);
  return hits
    .map((hit) => byId.get(hit.id as number))
    .filter((bin): bin is CatalogBin => bin !== undefined);
}

/** How a candidate is described to the classifier. Terse; it reads structure. */
function optionText(
  bin: CatalogBin,
  labelNames: ReadonlyMap<string, string>,
  notes: readonly string[],
  described: readonly string[],
): string {
  const parts: string[] = [];
  if (bin.name) parts.push(bin.name);
  if (bin.description) parts.push(bin.description);
  const cats = (bin.labelIds ?? [])
    .map((id) => labelNames.get(id))
    .filter(Boolean);
  if (cats.length) parts.push(`categories: ${cats.join(", ")}`);
  if (described.length) parts.push(`seen in photo: ${described.join(", ")}`);
  if (notes.length) parts.push(`notes: ${notes.join(" / ")}`);
  return parts.join(" — ") || "nothing recorded about this box";
}

export type RankedBox = { id: number; probability: number };

/**
 * Ask which of the candidates plausibly holds the thing.
 *
 * One choice question rather than a score per box: a single question returns
 * a probability for every option at once, which is the ranking, and costs one
 * round trip instead of forty.
 */
export async function rankCandidates(
  query: string,
  candidates: readonly CatalogBin[],
  data: CatalogData,
): Promise<RankedBox[] | null> {
  if (candidates.length === 0) return null;
  const labelNames = new Map(data.labels.map((l) => [l.id, l.name]));
  const criteria: Record<string, string> = {
    [NONE]: "None of these boxes plausibly holds it.",
  };
  for (const bin of candidates) {
    criteria[String(bin.id)] = optionText(
      bin,
      labelNames,
      data.notesByBin.get(bin.id) ?? [],
      data.describedByBin.get(bin.id) ?? [],
    );
  }

  const question: JevChoiceQuestion = {
    type: "choice",
    instructions:
      "Someone is looking for the thing described below in a warehouse of labelled storage boxes. Which box most likely holds it?",
    criteria,
  };

  try {
    const result = await askJev("jev:shortlist", query, { box: question });
    const answer = result.answers.box;
    if (!answer || answer.type !== "choice") return null;
    // Declining is a real answer, and acting on a forced pick would be worse
    // than handing the full catalog to something that can reason about it.
    if (answer.choice === NONE) return null;
    if (answer.confidence < JEV_MIN_CONFIDENCE) return null;

    return Object.entries(answer.probabilities)
      .filter(([id]) => id !== NONE)
      .map(([id, probability]) => ({ id: Number(id), probability }))
      .filter((r) => Number.isInteger(r.id) && r.probability > 0)
      .sort((a, b) => b.probability - a.probability);
  } catch (err) {
    if (!(err instanceof JevUnavailableError))
      console.error("candidate ranking failed:", err);
    return null;
  }
}
