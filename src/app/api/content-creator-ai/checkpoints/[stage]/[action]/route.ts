/**
 * POST /api/content-creator-ai/checkpoints/[stage]/[action]
 * Requirements 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10.
 *
 * Actions: approve | reject | edit | enable | disable.
 * A rejection without instructions or a replacement is refused with 422
 * (Requirement 12.7); disabling the last enabled checkpoint in HITL is refused
 * with 409 (Requirement 12.9).
 */
import {
  getRuntime,
  workflowStatus,
  jsonResponse,
  errorResponse,
  readJsonBody,
} from "@/lib/content-creator-ai/api/runtime.js";
import { APPROVAL_CHECKPOINT_STAGES } from "@/lib/content-creator-ai/orchestration/checkpoints.js";
import type { ApprovalCheckpointStage } from "@/lib/content-creator-ai/types/enums.js";

type RouteContext = {
  params:
    | Promise<{ stage: string; action: string }>
    | { stage: string; action: string };
};

interface Body {
  instructions?: string;
  replacement?: unknown;
  editedOutput?: unknown;
}

const ACTIONS = ["approve", "reject", "edit", "enable", "disable"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { stage, action } = await context.params;

  if (!(APPROVAL_CHECKPOINT_STAGES as readonly string[]).includes(stage)) {
    return errorResponse(`Unknown checkpoint stage: ${stage}`, 404);
  }
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return errorResponse(
      `Unknown action: ${action}. Expected one of ${ACTIONS.join(", ")}`,
      404,
    );
  }

  const checkpointStage = stage as ApprovalCheckpointStage;
  const body = (await readJsonBody<Body>(request)) ?? {};
  const { checkpoints, workflow } = getRuntime();

  try {
    switch (action as Action) {
      case "approve": {
        const result = await checkpoints.approve(checkpointStage);
        await workflow.resume();
        return jsonResponse({ ...result, status: workflowStatus() });
      }

      case "edit": {
        if (body.editedOutput === undefined) {
          return errorResponse("editedOutput is required to edit");
        }
        const result = await checkpoints.edit(checkpointStage, body.editedOutput);
        await workflow.resume();
        return jsonResponse({ ...result, status: workflowStatus() });
      }

      case "reject": {
        const result = await checkpoints.reject(checkpointStage, {
          instructions: body.instructions,
          replacement: body.replacement,
        });
        if (!result.ok) {
          // Requirement 12.7 — bare rejection is not accepted.
          return jsonResponse(result, 422);
        }
        await workflow.resume();
        return jsonResponse({ ...result, status: workflowStatus() });
      }

      case "enable": {
        const result = checkpoints.enableCheckpoint(checkpointStage);
        return jsonResponse({ ...result, status: workflowStatus() });
      }

      case "disable": {
        const result = checkpoints.disableCheckpoint(checkpointStage);
        // Requirement 12.9 — the last enabled checkpoint cannot be disabled.
        return jsonResponse({ ...result, status: workflowStatus() }, result.ok ? 200 : 409);
      }
    }
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Checkpoint action failed",
      409,
    );
  }

  return errorResponse("Unhandled action", 500);
}
