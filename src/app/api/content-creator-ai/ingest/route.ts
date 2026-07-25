/**
 * POST /api/content-creator-ai/ingest — trigger Context_Agent ingestion.
 * Requirements 1.1–1.7.
 *
 * Written against the Web-standard `Request`/`Response` types that the Next.js
 * App Router passes to route handlers, so no framework import is needed.
 */
import type { ContextAgentInput } from "@/lib/content-creator-ai/types/index.js";
import {
  getRuntime,
  jsonResponse,
  errorResponse,
  readJsonBody,
} from "@/lib/content-creator-ai/api/runtime.js";

interface IngestBody extends ContextAgentInput {
  /** Draft lifecycle actions: review a previously produced draft. */
  action?: "ingest" | "accept" | "edit" | "reject";
  draftId?: string;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<IngestBody>(request);
  if (!body) return errorResponse("Request body must be valid JSON");

  const { contextAgent } = getRuntime();
  const action = body.action ?? "ingest";

  try {
    switch (action) {
      case "accept": {
        if (!body.draftId) return errorResponse("draftId is required to accept");
        const result = await contextAgent.acceptDraft(body.draftId);
        return jsonResponse(result);
      }

      case "edit": {
        if (!body.draftId) return errorResponse("draftId is required to edit");
        if (!body.userEdits) return errorResponse("userEdits is required to edit");
        const summary = contextAgent.editDraft(body.draftId, body.userEdits);
        return jsonResponse({ draftId: body.draftId, companySummary: summary });
      }

      case "reject": {
        if (!body.draftId) return errorResponse("draftId is required to reject");
        // Requirement 1.7 — the KB is left untouched.
        return jsonResponse(contextAgent.rejectDraft(body.draftId));
      }

      default: {
        const result = await contextAgent.ingest({
          companyUrl: body.companyUrl,
          freeTextEnrichment: body.freeTextEnrichment,
          userEdits: body.userEdits,
        });
        // `recovery` holds closures, so expose the choices rather than the fns.
        const { recovery, ...rest } = result;
        return jsonResponse({
          ...rest,
          recovery: recovery
            ? { message: recovery.message, options: recovery.options }
            : undefined,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed";
    const knownDrafts = contextAgent.listDraftIds();
    console.error(
      `[ingest] ${action} failed: ${message}` +
        (body.draftId ? ` (requested draftId=${body.draftId})` : "") +
        ` | pendingDrafts=${knownDrafts.length ? knownDrafts.join(",") : "none"}`,
    );
    return errorResponse(message, 500);
  }
}
