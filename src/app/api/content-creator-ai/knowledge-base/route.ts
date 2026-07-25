/**
 * GET  /api/content-creator-ai/knowledge-base              — list KB entities
 * GET  /api/content-creator-ai/knowledge-base?entityId=…  — read a KB entity
 * PUT  /api/content-creator-ai/knowledge-base             — versioned write
 * Requirements 2.1, 2.2, 2.4.
 */
import {
  readKnowledgeBase,
  listKnowledgeBase,
  updateKnowledgeBase,
  jsonResponse,
  errorResponse,
  readJsonBody,
  type KBWriteRequest,
} from "@/lib/content-creator-ai/api/runtime.js";
import type { RetrievalScope } from "@/lib/content-creator-ai/types/enums.js";

const SCOPE_SECTION: Record<RetrievalScope, string> = {
  company_memory: "companyIdentity",
  product_context: "products",
  audience_learning: "audiences",
  experiment_history: "experiments",
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");

  // No entityId → catalog of markdown entities in the KB store.
  if (!entityId) {
    return jsonResponse(await listKnowledgeBase());
  }

  const scope = url.searchParams.get("scope") as RetrievalScope | null;
  if (scope && !(scope in SCOPE_SECTION)) {
    return errorResponse(`Unknown scope: ${scope}`);
  }

  const result = await readKnowledgeBase(entityId);
  if (!result.found) {
    return jsonResponse({ entityId, found: false }, 404);
  }

  // A scope narrows the response to the matching KB section.
  if (scope && result.parsed) {
    const key = SCOPE_SECTION[scope] as keyof typeof result.parsed;
    return jsonResponse({
      entityId,
      found: true,
      scope,
      section: result.parsed[key],
      markdown: result.markdown,
    });
  }

  return jsonResponse(result);
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonBody<KBWriteRequest>(request);
  if (!body) return errorResponse("Request body must be valid JSON");
  if (!body.entityId) return errorResponse("entityId is required");
  if (!body.entityType) return errorResponse("entityType is required");
  if (body.markdown === undefined && body.payload === undefined) {
    return errorResponse("Either markdown or payload is required");
  }

  try {
    return jsonResponse(await updateKnowledgeBase(body));
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Knowledge base write failed",
      500,
    );
  }
}
