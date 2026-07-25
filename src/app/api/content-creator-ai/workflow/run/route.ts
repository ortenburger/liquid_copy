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
    const status = workflowStatus();
    return jsonResponse({
      ...result,
      status,
      // Surface ContentGeneration studio deep-link for the UI.
      contentGeneration:
        (status.stages.find((s) => s.stage === "ContentGeneration")
          ?.output as Record<string, unknown> | undefined) ?? undefined,
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Workflow run failed",
      500,
    );
  }
}
