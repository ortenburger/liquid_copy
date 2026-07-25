/**
 * POST /api/content-creator-ai/config — apply integration secrets from the UI.
 */
import {
  jsonResponse,
  errorResponse,
  readJsonBody,
  applyRuntimeConfig,
} from "@/lib/content-creator-ai/api/runtime.js";

interface ConfigBody {
  firecrawlApiKey?: string;
  zernioApiKey?: string;
  zernioApiBaseUrl?: string;
  llm?: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    temperature?: number;
  };
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<ConfigBody>(request);
  if (!body) return errorResponse("Request body must be valid JSON");

  const applied = applyRuntimeConfig({
    firecrawlApiKey: body.firecrawlApiKey,
    zernioApiKey: body.zernioApiKey,
    zernioApiBaseUrl: body.zernioApiBaseUrl,
    llm: body.llm,
  });

  return jsonResponse({
    ok: true,
    applied,
    message: "Runtime config updated for this API process",
  });
}
