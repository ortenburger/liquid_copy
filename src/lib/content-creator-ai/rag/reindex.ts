import { eventBus } from "../orchestration/event-bus.js";
import type { KBEntityType, RetrievalScope } from "../types/enums.js";
import type { KBDocument } from "../types/index.js";
import { listKBEntities, readKBEntity } from "../kb/storage.js";
import { indexDocuments } from "./vectorstore.js";

const REINDEX_DEADLINE_MS = 60_000;

function scopeForEntityType(entityType: KBEntityType): RetrievalScope {
  switch (entityType) {
    case "company_identity":
      return "company_memory";
    case "product":
      return "product_context";
    case "audience":
      return "audience_learning";
    case "experiment":
      return "experiment_history";
  }
}

export interface ReindexHandle {
  /** Unsubscribe from kb.updated. */
  stop: () => void;
  /** Pending reindex timers (for tests). */
  pendingCount: () => number;
  /** Flush all pending reindexes immediately. */
  flush: () => Promise<void>;
}

/**
 * Subscribe to `kb.updated` and re-index affected documents within 60 seconds.
 * Requirement 14.4.
 */
/** Index every on-disk KB entity into the in-memory vector store (startup). */
export async function reindexAllKBEntities(options?: {
  storagePath?: string;
}): Promise<number> {
  const entities = await listKBEntities(options?.storagePath);
  const docs: KBDocument[] = [];
  for (const entity of entities) {
    const content = await readKBEntity(entity.entityId, options?.storagePath);
    if (content == null) continue;
    docs.push({
      id: `${entity.entityId}_v${entity.latestVersion}`,
      entityId: entity.entityId,
      entityType: entity.entityType,
      scope: scopeForEntityType(entity.entityType),
      content,
      metadata: { version: entity.latestVersion },
    });
  }
  if (docs.length > 0) await indexDocuments(docs);
  return docs.length;
}

export function startRAGReindexListener(options?: {
  /** Delay before reindex (default 0 for immediate; max 60s). */
  delayMs?: number;
  storagePath?: string;
}): ReindexHandle {
  const delayMs = Math.min(
    Math.max(options?.delayMs ?? 0, 0),
    REINDEX_DEADLINE_MS,
  );
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingWork = new Map<string, () => Promise<void>>();

  const runReindex = async (
    entityId: string,
    entityType: KBEntityType,
    version: number,
  ): Promise<void> => {
    const content = await readKBEntity(entityId, options?.storagePath);
    if (content == null) return;
    const doc: KBDocument = {
      id: `${entityId}_v${version}`,
      entityId,
      entityType,
      scope: scopeForEntityType(entityType),
      content,
      metadata: { version },
    };
    await indexDocuments([doc]);
  };

  const unsubscribe = eventBus.subscribe("kb.updated", (payload) => {
    const key = `${payload.entityId}:${payload.version}`;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);

    const work = () =>
      runReindex(payload.entityId, payload.entityType, payload.version);

    pendingWork.set(key, work);

    const timer = setTimeout(() => {
      timers.delete(key);
      pendingWork.delete(key);
      void work();
    }, delayMs);

    timers.set(key, timer);
  });

  return {
    stop: () => {
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      pendingWork.clear();
    },
    pendingCount: () => pendingWork.size,
    flush: async () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      const jobs = [...pendingWork.values()];
      pendingWork.clear();
      await Promise.all(jobs.map((j) => j()));
    },
  };
}
