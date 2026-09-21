/**
 * Which question did they mean?
 *
 * `/bins` used to carry two buttons — "Where is it?" and "Where should it
 * go?" — purely because the server needs to know which framing to use. That
 * is a decision about the text someone already typed, so it belongs to a
 * classifier rather than to the person.
 *
 * The input is not prose. It is whatever gets thumbed into a search box
 * while holding a drill: "sharpies", "extension cords", "putting away paint
 * rollers". The wording below was tested against exactly those.
 */
import { JEV_MIN_CONFIDENCE, askJev } from "./client";
import { type JevChoiceQuestion, JevUnavailableError } from "./types";

const QUESTION: JevChoiceQuestion = {
  type: "choice",
  instructions:
    "Someone typed this into the search box of a storage-inventory app for a warehouse of labelled boxes. Are they trying to FIND something that is already put away, or decide where to PUT something they are holding?",
  criteria: {
    find: "They are looking for a thing they believe is already in a box somewhere, and want to know which box or where it is.",
    place:
      "They have a thing in hand and want to know which box it should go into, or whether to start a new box.",
  },
};

export type Intent = {
  kind: "find" | "place";
  confidence: number;
};

/**
 * Route a query, or null when nobody should be guessing.
 *
 * Null covers three cases that are the same from the caller's side: no key
 * configured, the service could not be reached, and Jev itself reporting it
 * is unsure. In all three the honest move is to ask the person, which is
 * what the two buttons were for — so they come back.
 *
 * Never throws. A router that can break the search box is worse than no
 * router.
 */
export async function routeIntent(query: string): Promise<Intent | null> {
  try {
    const result = await askJev("jev:intent", query, { intent: QUESTION });
    const answer = result.answers.intent;
    if (!answer || answer.type !== "choice") return null;
    if (answer.confidence < JEV_MIN_CONFIDENCE) return null;
    if (answer.choice !== "find" && answer.choice !== "place") return null;
    return { kind: answer.choice, confidence: answer.confidence };
  } catch (err) {
    // Unavailable is the ordinary state on a deployment without a key and
    // deserves no noise; anything else is worth seeing in the log.
    if (!(err instanceof JevUnavailableError))
      console.error("intent routing failed:", err);
    return null;
  }
}
