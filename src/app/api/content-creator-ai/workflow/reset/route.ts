/**
 * POST /api/content-creator-ai/workflow/reset — clear stage progress.
 */
import {
  getRuntime,
  workflowStatus,
  jsonResponse,
} from "@/lib/content-creator-ai/api/runtime.js";

export async function POST(): Promise<Response> {
  const { workflow } = getRuntime();
  workflow.reset();
  return jsonResponse({
    ok: true,
    message: "Workflow reset to ContextIngestion",
    status: workflowStatus(),
  });
}
