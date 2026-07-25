/**
 * POST /api/content-creator-ai/workflow/reset — clear stage progress.
 */
import {
  getRuntime,
  workflowStatus,
  jsonResponse,
} from "@/lib/content-creator-ai/api/runtime.js";
import { clearWorkflowSnapshot } from "@/lib/content-creator-ai/api/workflow-persistence.js";

export async function POST(): Promise<Response> {
  const { workflow } = getRuntime();
  // Drop disk snapshot first, then reset in-memory (emits → re-persists pending).
  clearWorkflowSnapshot();
  workflow.reset();
  return jsonResponse({
    ok: true,
    message: "Workflow reset to ContextIngestion",
    status: workflowStatus(),
  });
}
