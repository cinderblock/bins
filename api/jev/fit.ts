/**
 * Does an existing box actually fit this, or is it time to start a new one?
 *
 * This is the judgment-heavy half of the placement answer and the part a
 * generative model is weakest at: it returns `newBox: true` with the same
 * flat certainty whether the case is obvious or a coin flip. Jev returns a
 * probability instead, so "we are not sure" becomes something the UI can
 * say rather than something it hides.
 *
 * It runs over the candidate boxes the generative model just named, not the
 * whole catalog — that keeps the state small and makes this a second opinion
 * on a specific claim rather than a re-run of the whole question.
 */
import { askJev } from "./client";
import { type JevNoulQuestion, JevUnavailableError } from "./types";

const QUESTION: JevNoulQuestion = {
  type: "noul",
  instructions:
    "Does one of the existing boxes listed above have BOTH a matching purpose AND enough room left for the thing being put away?",
  criteria: {
    true: "At least one listed box is the right kind of place for this thing and still has space for it.",
    false:
      "Nothing listed is the right kind of place, or every box that matches is too full to take it — a new box should be started.",
  },
};

/** One candidate, described the way the question needs to see it. */
export type FitCandidate = {
  id: number;
  name: string | null;
  description: string | null;
  fillLevel: number | null;
  size: string | null;
};

export type FitVerdict = {
  /** Probability that one of the candidates genuinely fits. */
  probability: number;
  /** The call: below 0.5 means start a new box. */
  newBox: boolean;
};

function describe(candidate: FitCandidate): string {
  const parts = [`#${candidate.id}`];
  if (candidate.name) parts.push(`"${candidate.name}"`);
  if (candidate.description) parts.push(`— ${candidate.description}`);
  if (candidate.size) parts.push(`(${candidate.size})`);
  // Fullness is the half a generative model tends to skate over, so it is
  // stated plainly rather than left to be inferred from prose.
  parts.push(
    candidate.fillLevel === null
      ? "— fullness not recorded"
      : `— ${candidate.fillLevel}% full`,
  );
  return parts.join(" ");
}

/**
 * Second-opinion the new-box decision, or null when nobody can.
 *
 * Null means "no better information than the generative model already gave
 * you" — the caller keeps whatever it had. Never throws, for the same reason
 * routeIntent does not: this is an improvement on an answer, and it must not
 * be able to take the answer away.
 */
export async function verifyFit(
  item: string,
  candidates: readonly FitCandidate[],
): Promise<FitVerdict | null> {
  // With nothing to compare against there is no question to ask: a new box is
  // the only option, and the generative model will already have said so.
  if (candidates.length === 0) return null;
  const state = [
    "Existing boxes that might suit:",
    ...candidates.map(describe),
    "",
    `Thing to put away: ${item}`,
  ].join("\n");

  try {
    const result = await askJev("jev:fit", state, { fits: QUESTION });
    const answer = result.answers.fits;
    if (!answer || answer.type !== "noul") return null;
    return { probability: answer.noul, newBox: answer.noul < 0.5 };
  } catch (err) {
    if (!(err instanceof JevUnavailableError))
      console.error("fit verification failed:", err);
    return null;
  }
}
