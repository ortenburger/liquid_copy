/**
 * GET  /api/content-creator-ai/knowledge-base              — status + entity catalog
 * GET  /api/content-creator-ai/knowledge-base?entityId=…  — read a KB entity
 * PUT  /api/content-creator-ai/knowledge-base             — versioned write
 * DELETE /api/content-creator-ai/knowledge-base           — clear all KB data
 * POST  /api/content-creator-ai/knowledge-base             — { action: "reindex" }
 * Requirements 2.1, 2.2, 2.4.
 */
import {
  readKnowledgeBase,
  listKnowledgeBase,
  updateKnowledgeBase,
  jsonResponse,
  errorResponse,
  readJsonBody,
  type KBWriteRequest,
} from "@/lib/content-creator-ai/api/runtime.js";
import type { RetrievalScope } from "@/lib/content-creator-ai/types/enums.js";
import {
  clearAllKBStorage,
  listKBEntityIds,
  resolveKBStoragePath,
} from "@/lib/content-creator-ai/kb/storage.js";
import { rebuildVectorIndexFromDisk } from "@/lib/content-creator-ai/rag/reindex.js";
import { getVectorStore } from "@/lib/content-creator-ai/rag/vectorstore.js";

const SCOPE_SECTION: Record<RetrievalScope, string> = {
  company_memory: "companyIdentity",
  product_context: "products",
  audience_learning: "audiences",
  experiment_history: "experiments",
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");

  // No entityId → status + catalog of markdown entities in the KB store.
  if (!entityId) {
    const catalog = await listKnowledgeBase();
    const entityIds = listKBEntityIds();
    return jsonResponse({
      storagePath: resolveKBStoragePath(),
      entityCount: entityIds.length,
      entityIds,
      indexedDocuments: getVectorStore().size(),
      persistent: true,
      entities: catalog.entities,
      count: catalog.count,
    });
  }

  const scope = url.searchParams.get("scope") as RetrievalScope | null;
  if (scope && !(scope in SCOPE_SECTION)) {
    return errorResponse(`Unknown scope: ${scope}`);
  }

  const result = await readKnowledgeBase(entityId);
  if (!result.found) {
    return jsonResponse({ entityId, found: false }, 404);
  }

  if (scope && result.parsed) {
    const key = SCOPE_SECTION[scope] as keyof typeof result.parsed;
    return jsonResponse({
      entityId,
      found: true,
      scope,
      section: result.parsed[key],
      markdown: result.markdown,
    });
  }

  return jsonResponse(result);
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonBody<KBWriteRequest>(request);
  if (!body) return errorResponse("Request body must be valid JSON");
  if (!body.entityId) return errorResponse("entityId is required");
  if (!body.entityType) return errorResponse("entityType is required");
  if (body.markdown === undefined && body.payload === undefined) {
    return errorResponse("Either markdown or payload is required");
  }

  try {
    return jsonResponse(await updateKnowledgeBase(body));
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Knowledge base write failed",
      500,
    );
  }
}

/** Clear on-disk KB + in-memory RAG index (Knowledge tab only). */
export async function DELETE(request: Request): Promise<Response> {
  const body = await readJsonBody<{ confirm?: boolean }>(request);
  if (!body?.confirm) {
    return errorResponse('Pass { "confirm": true } to clear the knowledge base');
  }

  const cleared = clearAllKBStorage();
  await getVectorStore().clear();
  console.info(
    `[kb] cleared ${cleared.removed.length} entit(ies) under ${cleared.root}`,
  );

  return jsonResponse({
    ok: true,
    removed: cleared.removed,
    storagePath: cleared.root,
    indexedDocuments: 0,
    message: "Knowledge base cleared",
  });
}

/** Re-index from disk without deleting. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<{ action?: string }>(request);
  if (body?.action === "reindex") {
    const result = await rebuildVectorIndexFromDisk();
    return jsonResponse({ ok: true, ...result });
  }
  return errorResponse('Unknown action — use { "action": "reindex" }');
}
