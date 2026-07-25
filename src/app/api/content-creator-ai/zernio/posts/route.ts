/**
 * GET /api/content-creator-ai/zernio/posts — list draft/scheduled posts from Zernio.
 */
import {
  jsonResponse,
  errorResponse,
} from "@/lib/content-creator-ai/api/runtime.js";
import { listZernioPosts } from "@/lib/content-creator-ai/integrations/zernio-publish.js";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const statuses = statusParam
      ? statusParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["draft", "scheduled"];
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const limit = Number(url.searchParams.get("limit") ?? "25") || 25;
    const accountId = url.searchParams.get("accountId") ?? undefined;
    const sortBy = url.searchParams.get("sortBy") ?? undefined;

    const result = await listZernioPosts({
      status: statuses,
      page,
      limit: Math.min(Math.max(limit, 1), 50),
      accountId: accountId || undefined,
      sortBy: sortBy || undefined,
    });

    return jsonResponse(result, 200);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Failed to list Zernio posts",
      500,
    );
  }
}
