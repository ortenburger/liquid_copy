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

    // If a prior Full Auto pass completed Publishing with zero variants,
    // reopen Publishing → Learning so A/B can run without a full Reset.
    const publishRec = workflow.listRecords().find((r) => r.stage === "PublishingQueue");
    const publishOut = publishRec?.output as { queued?: number } | undefined;
    if (
      publishRec?.status === "completed" &&
      (publishOut?.queued === 0 || publishOut?.queued == null)
    ) {
      const hyp = workflow
        .listRecords()
        .find((r) => r.stage === "HypothesisGeneration");
      if (hyp?.status === "completed") {
        console.info(
          "[workflow] reopening PublishingQueue → LearningUpdate for Full Auto A/B retry",
        );
        workflow.reopenFrom("PublishingQueue");
      }
    }

    const result = await workflow.run();
    const status = workflowStatus();
    return jsonResponse({
      ...result,
      status,
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
