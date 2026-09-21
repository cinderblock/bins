/**
 * TypeSafe AI's System One API, typed and validated.
 *
 * Deliberately NOT a fourth entry in api/ai/provider.ts. That interface is
 * "layered prompt + JSON schema → parsed JSON", shaped by chat completions,
 * and this is a different thing entirely: a state plus typed questions in, a
 * typed decision with calibrated probabilities out. Forcing them together
 * would mean a provider that cannot answer a question and a classifier that
 * cannot write a sentence, both pretending otherwise.
 *
 * The answers are described as type-safe at the source. They are still
 * validated here — a shape that arrives over a network is a claim, not a
 * guarantee, and a silently-wrong `confidence` would quietly disable exactly
 * the threshold this module exists to apply.
 */
import { z } from "zod";

/** Yes/no: the probability the statement is true. */
export const jevNoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

/** Pick one of the named options, with a probability for each. */
export const jevChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  /** How peaked the distribution is. The whole basis for trusting an answer. */
  confidence: z.number().min(0).max(1),
});

/**
 * A position along an ordered spectrum. `score` is a number and may fall
 * BETWEEN levels, so it is not an index — rounding it to one loses the part
 * that makes it useful for ranking.
 */
export const jevScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.array(z.number()),
  confidence: z.number().min(0).max(1),
});

export const jevAnswerSchema = z.discriminatedUnion("type", [
  jevNoulAnswerSchema,
  jevChoiceAnswerSchema,
  jevScoreAnswerSchema,
]);
export type JevAnswer = z.infer<typeof jevAnswerSchema>;

export const jevResponseSchema = z.object({
  /** The versioned id that actually answered ("jev-1.13.0"), not the alias. */
  model: z.string(),
  answers: z.record(z.string(), jevAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});
export type JevResponse = z.infer<typeof jevResponseSchema>;

/** A yes/no question. `criteria` says what each verdict means. */
export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

/** Pick one. `criteria` maps each option to what it means. Max 255 options. */
export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

/** Rate along a spectrum. `criteria` is ORDERED, lowest level first. */
export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevQuestion =
  | JevNoulQuestion
  | JevChoiceQuestion
  | JevScoreQuestion;

/** No key configured — every caller treats this as "feature off", not an error. */
export class JevUnavailableError extends Error {}
/** The service was reached and refused, or answered something unusable. */
export class JevError extends Error {}
