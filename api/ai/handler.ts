/**
 * HTTP edge for the AI assistant: the gate, the parse, and turning this
 * module's error types into status codes a client can act on.
 *
 * Separate from ask.ts so that file stays about the question rather than
 * about transport, and so the captioning feature (plans/bins.md Phase 5) can
 * reuse the same error mapping when it lands.
 */
import { aiAssistAdminOnly } from "../config";
import { type Ctx, error, json } from "../context";
import { type AskRequestInput, askRequestSchema, handleAsk } from "./ask";
import { AiBudgetError, AiProviderError, AiUnavailableError } from "./types";

/**
 * Map a failure to a status the UI can distinguish.
 *
 * These are meaningfully different to a person: "the operator never turned
 * this on" is permanent and the feature should hide itself; "this month's
 * budget is spent" is temporary and worth saying out loud; "the provider is
 * having a bad day" is worth a retry.
 */
export function aiErrorResponse(err: unknown): Response {
  if (err instanceof AiUnavailableError)
    return error(503, "AI assistance is not configured on this server");
  if (err instanceof AiBudgetError) return error(402, err.message);
  if (err instanceof AiProviderError) return error(502, err.message);
  throw err;
}

export async function handleAskRequest(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);

  if (aiAssistAdminOnly()) {
    // Imported lazily: the common configuration never takes this path, and a
    // top-level import would tie the assistant to the admin module for it.
    const { requireAdmin } = await import("../admin");
    const group = await requireAdmin(ctx, body);
    if (group instanceof Response) return group;
  }

  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) return error(400, "invalid question");

  try {
    return await handleAsk(ctx, parsed.data as AskRequestInput);
  } catch (err) {
    return aiErrorResponse(err);
  }
}

/** Re-exported so the router reaches the whole surface through one module. */
export { aiStatus } from "./provider";
