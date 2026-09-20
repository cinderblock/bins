/**
 * The vendor-neutral surface every AI provider implements.
 *
 * Types and errors live here rather than in provider.ts so the providers and
 * the registry that imports them never form a cycle.
 *
 * The shape is deliberately small. Everything this app asks of a model is
 * "read a lot of stable context, answer one question, reply as JSON matching
 * this schema" — so the interface is exactly that, and a new provider is one
 * file that maps it onto a wire format.
 */

/**
 * The JSON Schema subset every provider accepts.
 *
 * The intersection is narrower than any one of them: Gemini takes an OpenAPI
 * subset that rejects `additionalProperties`, OpenAI's strict mode *requires*
 * it alongside an exhaustive `required`, and Anthropic takes ordinary JSON
 * Schema. So the canonical schema carries only what all three understand and
 * each adapter adds its own dialect's demands.
 *
 * Note the absence of nullability. Rather than pick between `nullable: true`
 * and `type: [..., "null"]`, schemas here use an empty string or an empty
 * array for "nothing", which every provider expresses identically.
 */
export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  enum?: string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

/**
 * One slice of the prompt, ordered stable-first.
 *
 * `stable` means "byte-identical on the next request", which is the only
 * thing prompt caching cares about — it is a prefix match on every provider
 * that offers one. The providers that cache implicitly (Gemini, OpenAI) need
 * nothing but the ordering; Anthropic gets an explicit breakpoint after the
 * last stable layer. See plans/ai-assist.md for why the catalog is split this
 * way.
 */
export type AiLayer = { stable: boolean; text: string };

/** A picture the question is about. Base64, no data-URL prefix. */
export type AiImage = { mime: string; base64: string };

export type AiAsk = {
  /** Ordered, stable layers first. Unstable layers must come after. */
  layers: AiLayer[];
  /** The volatile part — never cached, always last. */
  question: string;
  /**
   * Optional image, sent alongside the question rather than in the layers:
   * it is the most volatile part of the request and must never land inside
   * the cached prefix, or one photo would evict the catalog for the next.
   */
  image?: AiImage;
  schema: JsonSchema;
  maxOutputTokens: number;
};

export type AiUsage = {
  /** Input billed at the full rate. */
  inputTokens: number;
  /** Input served from a cache, billed at the provider's cached rate. */
  cachedInputTokens: number;
  /** Input written INTO a cache. Anthropic charges a premium; others don't. */
  cacheWriteTokens: number;
  outputTokens: number;
};

export type AiAnswer = {
  /** Parsed JSON matching the request's schema. */
  json: unknown;
  model: string;
  usage: AiUsage;
};

/** USD per million tokens. */
export type AiModelInfo = {
  id: string;
  label: string;
  inputUsd: number;
  cachedInputUsd: number;
  /** Cost of writing a cache entry. Equals inputUsd where writes are free. */
  cacheWriteUsd: number;
  outputUsd: number;
};

export interface AiProvider {
  readonly id: string;
  /** Env var holding this provider's key. */
  readonly keyEnv: string;
  readonly models: AiModelInfo[];
  readonly defaultModel: string;
  ask(model: string, key: string, req: AiAsk): Promise<AiAnswer>;
}

/** No provider is configured — the feature is simply off. */
export class AiUnavailableError extends Error {}
/** The monthly ceiling would be exceeded. */
export class AiBudgetError extends Error {}
/** The provider was reached and said no, or said something unusable. */
export class AiProviderError extends Error {}

/** Shared by every adapter: a non-2xx is the provider's message, truncated. */
export async function providerFailure(
  provider: string,
  response: Response,
): Promise<AiProviderError> {
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  return new AiProviderError(
    `${provider} returned ${response.status}: ${detail}`,
  );
}

/**
 * Parse a model's reply as JSON.
 *
 * Structured output modes make this reliable rather than guaranteed, and a
 * model that returns prose here is a bug worth seeing in the log rather than
 * a crash — so the failure carries what actually came back.
 */
export function parseJsonReply(provider: string, text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new AiProviderError(`${provider} returned nothing`);
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AiProviderError(
      `${provider} returned unparseable JSON: ${trimmed.slice(0, 200)}`,
    );
  }
}

/**
 * Add the two things strict schema modes demand: `additionalProperties: false`
 * on every object, and a `required` naming every property.
 *
 * Forcing everything required is correct here rather than lossy, because the
 * canonical schemas carry no optional fields by design — "nothing" is an
 * empty string or an empty array, so there is never a property that may be
 * absent. Both OpenAI's strict json_schema and Anthropic's output_config
 * want this shape; Gemini rejects it, which is why it isn't in the canonical
 * form.
 */
export function toStrictSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toStrictSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toStrictSchema(v)]),
    );
    out.required = Object.keys(schema.properties);
    out.additionalProperties = false;
  }
  return out;
}
