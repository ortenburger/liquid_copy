/**
 * GET /api/content-creator-ai/traceability/[variantId]
 * Requirements 13.1, 13.2, 13.4, 13.5 — full chain within 3 seconds; partial
 * chains come back with an in-progress/partial status marker.
 */
import {
  getRuntime,
  jsonResponse,
  errorResponse,
} from "@/lib/content-creator-ai/api/runtime.js";

/** Next.js 15+ passes route params as a Promise; earlier versions pass the object. */
type RouteContext = {
  params: Promise<{ variantId: string }> | { variantId: string };
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { variantId } = await context.params;
  if (!variantId) return errorResponse("variantId is required");

  const { traceability } = getRuntime();
  if (!traceability.has(variantId)) {
    return jsonResponse(
      { postVariantId: variantId, found: false },
      404,
    );
  }

  const result = traceability.build(variantId);
  return jsonResponse({
    postVariantId: variantId,
    found: true,
    status: result.status,
    chain: result.chain,
    humanEdits: result.humanEdits,
    missingStages: result.missingStages,
    durationMs: result.durationMs,
  });
}
