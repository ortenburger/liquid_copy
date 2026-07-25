/**
 * GET /api/content-creator-ai/workflow/status — current FSM state and mode.
 * PUT — switch operating mode (Requirement 12.8).
 * Requirements 12.1, 12.4, 12.8.
 */
import {
  getRuntime,
  workflowStatus,
  jsonResponse,
  errorResponse,
  readJsonBody,
} from "@/lib/content-creator-ai/api/runtime.js";
import type { OperatingMode } from "@/lib/content-creator-ai/types/enums.js";

const MODES: OperatingMode[] = ["Full_Auto_Mode", "Human_In_The_Loop_Mode"];

export async function GET(): Promise<Response> {
  return jsonResponse(workflowStatus());
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonBody<{ mode?: string }>(request);
  if (!body) return errorResponse("Request body must be valid JSON");
  if (!MODES.includes(body.mode as OperatingMode)) {
    return errorResponse(`mode must be one of ${MODES.join(", ")}`);
  }

  const { workflow } = getRuntime();
  const result = workflow.setMode(body.mode as OperatingMode);
  return jsonResponse({ ...result, status: workflowStatus() });
}
