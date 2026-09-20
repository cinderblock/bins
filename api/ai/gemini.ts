/**
 * Google Generative Language — the default provider.
 *
 * Default because a deployment that prints labels already holds
 * `GEMINI_API_KEY` (see api/labels/art.ts), so the out-of-the-box path costs
 * the operator no new account with anyone. Nothing here is load-bearing: the
 * other two providers implement the same interface and one env var switches.
 *
 * Caching is IMPLICIT and needs no code — Gemini discounts a prefix it has
 * seen before. That is exactly why the catalog is layered stable-first with
 * an append-only diff tail (plans/ai-assist.md): without a byte-stable
 * prefix, an actively-used group would never see a cache hit at all.
 *
 * Explicit caching is deliberately NOT used. It bills an hourly storage meter
 * whether or not the cache is read, which for a few storage sessions a week
 * costs far more than it saves.
 */
import {
  type AiAnswer,
  type AiAsk,
  type AiModelInfo,
  type AiProvider,
  type JsonSchema,
  parseJsonReply,
  providerFailure,
} from "./types";

/**
 * Three tiers, so the choice is "how much do I care about this answer" rather
 * than a model catalogue. Rates are USD per million tokens, used for budget
 * accounting — a ceiling to stop runaway spend, not an invoice. Cached input
 * is Google's ~10% implicit-cache rate.
 */
const MODELS: AiModelInfo[] = [
  {
    id: "gemini-3-flash-preview",
    label: "Fast",
    inputUsd: 0.5,
    cachedInputUsd: 0.05,
    cacheWriteUsd: 0.5,
    outputUsd: 3,
  },
  {
    id: "gemini-3.6-flash",
    label: "Balanced",
    inputUsd: 0.75,
    cachedInputUsd: 0.075,
    cacheWriteUsd: 0.75,
    outputUsd: 3.75,
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Careful",
    inputUsd: 2,
    cachedInputUsd: 0.2,
    cacheWriteUsd: 2,
    outputUsd: 12,
  },
];

/**
 * Gemini's `responseSchema` is an OpenAPI subset: the type is the proto enum
 * in upper case, and anything it doesn't know (notably `additionalProperties`,
 * which OpenAI's strict mode demands) is rejected rather than ignored.
 */
function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  if (schema.required) out.required = schema.required;
  return out;
}

export const geminiProvider: AiProvider = {
  id: "gemini",
  keyEnv: "GEMINI_API_KEY",
  models: MODELS,
  defaultModel: "gemini-3.6-flash",

  async ask(model: string, key: string, req: AiAsk): Promise<AiAnswer> {
    // Layer order IS the cache strategy — the stable layers land at the front
    // of the system instruction, the question goes in `contents` after them.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: {
            parts: req.layers.map((layer) => ({ text: layer.text })),
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: req.question },
                ...(req.image
                  ? [
                      {
                        inlineData: {
                          mimeType: req.image.mime,
                          data: req.image.base64,
                        },
                      },
                    ]
                  : []),
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(req.schema),
            maxOutputTokens: req.maxOutputTokens,
            // The same catalog and the same question should give the same
            // answer twice; this is a lookup, not a brainstorm.
            temperature: 0,
          },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) throw await providerFailure("gemini", response);

    const body = (await response.json()) as {
      candidates?: {
        finishReason?: string;
        content?: { parts?: { text?: string }[] };
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        cachedContentTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    const usage = body.usageMetadata ?? {};
    // promptTokenCount INCLUDES the cached portion, so the uncached remainder
    // is the difference — billing them both at the full rate would roughly
    // double every logged cost.
    const cached = usage.cachedContentTokenCount ?? 0;
    return {
      json: parseJsonReply("gemini", text),
      model,
      usage: {
        inputTokens: Math.max(0, (usage.promptTokenCount ?? 0) - cached),
        cachedInputTokens: cached,
        cacheWriteTokens: 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
      },
    };
  },
};
