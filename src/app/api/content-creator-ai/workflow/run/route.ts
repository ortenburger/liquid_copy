/**
 * POST /api/content-creator-ai/workflow/run — advance the workflow engine.
 */
import {
  getRuntime,
  workflowStatus,
  jsonResponse,
  errorResponse,
} from "@/lib/content-creator-ai/api/runtime.js";

export async function POST(): Promise<Response> {
  try {
    const { workflow } = getRuntime();
    const result = await workflow.run();
    return jsonResponse({ ...result, status: workflowStatus() });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Workflow run failed",
      500,
    );
  }
}
