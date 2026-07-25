/**
 * POST /api/content-creator-ai/platform-selection
 * Requirements 5.1, 5.2, 5.4 — replace the active publishing targets; an empty
 * selection is reported as blocking content generation.
 */
import {
  updatePlatformSelection,
  jsonResponse,
  errorResponse,
  readJsonBody,
} from "@/lib/content-creator-ai/api/runtime.js";
import { SUPPORTED_PLATFORMS } from "@/lib/content-creator-ai/agents/strategy-agent/goal-validation.js";

interface Body {
  platforms?: unknown;
}

export async function GET(): Promise<Response> {
  // Requirement 5.1 — present the supported channels.
  return jsonResponse({ supported: SUPPORTED_PLATFORMS });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<Body>(request);
  if (!body) return errorResponse("Request body must be valid JSON");
  if (!Array.isArray(body.platforms)) {
    return errorResponse("platforms must be an array");
  }

  const result = updatePlatformSelection(body.platforms);
  return jsonResponse(
    { ...result, supported: SUPPORTED_PLATFORMS },
    // An empty selection is stored but is not a usable state (Requirement 5.4).
    result.ok ? 200 : 422,
  );
}
