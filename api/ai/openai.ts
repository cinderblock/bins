/**
 * OpenAI — one of the two alternatives to the default.
 *
 * Set `OPENAI_API_KEY` and `AI_PROVIDER=openai` and this takes over; nothing
 * else in the app changes. Caching, as on Gemini, is automatic and prefix-
 * based, so the layered catalog (plans/ai-assist.md) is what makes it fire.
 */
import {
  type AiAnswer,
  type AiAsk,
  type AiModelInfo,
  type AiProvider,
  parseJsonReply,
  providerFailure,
  toStrictSchema,
} from "./types";

/** USD per million tokens; cached input is OpenAI's ~10% automatic rate. */
const MODELS: AiModelInfo[] = [
  {
    id: "gpt-5.6-luna",
    label: "Fast",
    inputUsd: 0.2,
    cachedInputUsd: 0.02,
    cacheWriteUsd: 0.2,
    outputUsd: 1.2,
  },
  {
    id: "gpt-5.6-terra",
    label: "Balanced",
    inputUsd: 2,
    cachedInputUsd: 0.2,
    cacheWriteUsd: 2,
    outputUsd: 12,
  },
  {
    id: "gpt-5.6-sol",
    label: "Careful",
    inputUsd: 4,
    cachedInputUsd: 0.4,
    cacheWriteUsd: 4,
    outputUsd: 20,
  },
];

export const openaiProvider: AiProvider = {
  id: "openai",
  keyEnv: "OPENAI_API_KEY",
  models: MODELS,
  defaultModel: "gpt-5.6-terra",

  async ask(model: string, key: string, req: AiAsk): Promise<AiAnswer> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        // One system message per layer, in order, then the question. Prefix
        // caching keys off the rendered prefix, so the ordering is the point.
        messages: [
          ...req.layers.map((layer) => ({
            role: "system",
            content: layer.text,
          })),
          {
            role: "user",
            content: req.image
              ? [
                  { type: "text", text: req.question },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${req.image.mime};base64,${req.image.base64}`,
                    },
                  },
                ]
              : req.question,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "answer",
            strict: true,
            schema: toStrictSchema(req.schema),
          },
        },
        max_completion_tokens: req.maxOutputTokens,
        // No `temperature`: the current reasoning models reject sampling
        // parameters outright, and a 400 here would be a puzzling failure for
        // an operator who only switched providers.
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw await providerFailure("openai", response);

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const usage = body.usage ?? {};
    // prompt_tokens is the total INCLUDING the cached part — see gemini.ts.
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      json: parseJsonReply("openai", body.choices?.[0]?.message?.content ?? ""),
      model,
      usage: {
        inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
        cachedInputTokens: cached,
        cacheWriteTokens: 0,
        outputTokens: usage.completion_tokens ?? 0,
      },
    };
  },
};
