/**
 * POST /api/content-creator-ai/search — manual natural-language KB search.
 * Requirement 14.5: results within 3 seconds, up to 10 per query.
 */
import {
  searchKnowledge,
  MAX_SEARCH_RESULTS,
  jsonResponse,
  errorResponse,
  readJsonBody,
  type SearchRequest,
} from "@/lib/content-creator-ai/api/runtime.js";

const SCOPES = new Set([
  "product_context",
  "company_memory",
  "experiment_history",
  "audience_learning",
]);

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<SearchRequest>(request);
  if (!body) return errorResponse("Request body must be valid JSON");
  if (typeof body.query !== "string" || body.query.trim().length === 0) {
    return errorResponse("query is required");
  }
  if (body.scope !== undefined && !SCOPES.has(body.scope)) {
    return errorResponse(`Unknown scope: ${body.scope}`);
  }

  const response = await searchKnowledge({
    query: body.query,
    scope: body.scope,
    limit: body.limit,
  });

  return jsonResponse({ ...response, maxResults: MAX_SEARCH_RESULTS });
}
