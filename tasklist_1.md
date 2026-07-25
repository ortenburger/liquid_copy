# Task List — Part 1 of 3: Shared Foundation (Types, KB, RAG, Event Bus)

## Assigned To: Cursor Agent 1

## Purpose
This agent builds the shared infrastructure that Agent 2 and Agent 3 import from but do **not** implement themselves. The output is a stable set of contracts (TypeScript interfaces + working storage/retrieval primitives) that both other agents can code against immediately — no waiting required.

Agent 2 and Agent 3 start in parallel. They import types and call KB/RAG/Event Bus APIs. If those APIs are not yet complete, they stub them locally and replace the stubs once Agent 1 merges.

---

## Tasks

- [ ] 1. Project foundation — types, interfaces, and directory structure
  - Create `src/lib/content-creator-ai/` directory tree: `agents/`, `kb/`, `rag/`, `orchestration/`, `publishing/`, `integrations/`, `api/`, `types/`
  - Define all core TypeScript interfaces in `src/lib/content-creator-ai/types/index.ts`:
    - `CompanyIdentity`, `KBVersion`, `MarketingGoal`, `SuccessMetric`
    - `AudiencePersona`, `Hypothesis`, `PostVariant`, `PostSlide`
    - `AnalyticsReport`, `ZernioMetrics`, `ExperimentSignificanceResult`
    - `ExperimentEvaluation`, `PostVariantOutcome`, `ContentPattern`
    - `TraceabilityChain`, `TraceabilityLink`, `PublishRecord`
    - `RoadmapEntry`, `ExperimentationRoadmap`, `RAGPassage`, `KBDocument`
    - `ContextAgentInput`, `ContextAgentOutput`
  - Create `src/lib/content-creator-ai/types/enums.ts`:
    - `SocialPlatform` union (instagram | tiktok | linkedin | facebook | pinterest | etsy | x | threads | youtube_shorts)
    - `ApprovalCheckpointStage` (ContextReview | GoalReview | AudienceReview | RoadmapReview | HypothesisReview | ContentReview | PublishingApproval | ExperimentReview | NextIterationPlanning)
    - `OperatingMode` (Full_Auto_Mode | Human_In_The_Loop_Mode)
    - `RetrievalScope` (product_context | company_memory | experiment_history | audience_learning)
    - `KBEntityType` (company_identity | product | audience | experiment)
  - Export everything from `src/lib/content-creator-ai/types/index.ts` as the single import point for Agents 2 and 3
  - Set up Vitest config and `tests/pbt/` directory with placeholder files for all 12 PBT test files:
    `kb-merge.pbt.test.ts`, `rag-retrieval.pbt.test.ts`, `goal-validation.pbt.test.ts`, `persona.pbt.test.ts`, `platform-validation.pbt.test.ts`, `roadmap.pbt.test.ts`, `hypothesis.pbt.test.ts`, `post-variant.pbt.test.ts`, `analytics.pbt.test.ts`, `learning-agent.pbt.test.ts`, `workflow-engine.pbt.test.ts`, `traceability.pbt.test.ts`
  - _Requirements: All (foundational scaffolding)_

- [ ] 2. Knowledge Base (KB) storage layer
  - [ ] 2.1 Implement KB file storage in `src/lib/content-creator-ai/kb/storage.ts`
    - Write `readKBEntity`, `writeKBEntity`, `listVersions`, `getVersionChain` functions
    - Implement write-once snapshot files `{entity_id}_v{n}.md` and `{entity_id}_current.md` symlink/reference pattern
    - Implement monotonically-incrementing version counter stored alongside each experiment record
    - Reject any attempt to modify or delete an existing snapshot (throw on overwrite)
    - _Requirements: 2.1, 2.2, 11.7_

  - [ ] 2.2 Implement KB Markdown serialiser/parser in `src/lib/content-creator-ai/kb/markdown.ts`
    - Serialise `CompanyIdentity`, `Product`, `AudiencePersona`, `Experiment` entities to Markdown with required top-level sections: `Company_Identity`, `Products`, `Audiences`, `Experiments`
    - Parse Markdown back to typed objects; validate all four sections are present and non-empty for populated entities
    - _Requirements: 2.1_

  - [ ] 2.3 Implement KB merge logic in `src/lib/content-creator-ai/kb/merge.ts`
    - Implement deep merge where `userProvidedValues` keys always overwrite scraped/existing values for conflicting fields
    - Preserve all non-conflicting existing KB fields unchanged
    - _Requirements: 1.2, 1.3_

  - [ ]* 2.4 Write property tests for KB storage and Markdown serialisation — `tests/pbt/kb-merge.pbt.test.ts`
    - **Property 1: User-provided values always take precedence in KB merge** — Validates: Requirements 1.2, 1.3
    - **Property 3: KB edit always creates a version record with prior values** — Validates: Requirements 1.6, 2.2
    - **Property 4: Rejection never mutates the KB** — Validates: Requirements 1.7, 7.7
    - **Property 5: KB Markdown serialisation preserves required sections** — Validates: Requirement 2.1
    - **Property 6: Version history is append-only and monotonically ordered** — Validates: Requirements 2.2, 11.7

- [ ] 3. RAG Layer
  - [ ] 3.1 Implement RAG vector store adapter in `src/lib/content-creator-ai/rag/vectorstore.ts`
    - Wrap local embedding model (`nomic-embed-text` via Ollama) and vector store (ChromaDB or `hnswlib`)
    - Implement `indexDocuments(docs: KBDocument[]): Promise<void>` and `semanticSearch({ query, scope, k }): Promise<RAGPassage[]>`
    - Enforce retrieval scope filtering: `product_context`, `company_memory`, `experiment_history`, `audience_learning`
    - Return `[]` (not an error) when unavailable or zero results found
    - _Requirements: 2.3, 14.1, 14.2, 14.3_

  - [ ] 3.2 Implement RAG re-index trigger in `src/lib/content-creator-ai/rag/reindex.ts`
    - Subscribe to `kb.updated` events from the Event Bus; trigger re-indexing of affected documents within 60 seconds
    - _Requirements: 14.4_

  - [ ]* 3.3 Write property tests for RAG retrieval — `tests/pbt/rag-retrieval.pbt.test.ts`
    - **Property 7: RAG returns at most k results, all from indexed content** — Validates: Requirement 2.3
    - **Property 29: RAG passage count is always min(available, 5)** — Validates: Requirements 14.2, 14.6

- [ ] 4. Event Bus
  - [ ] 4.1 Implement the Event Bus in `src/lib/content-creator-ai/orchestration/event-bus.ts`
    - Typed event definitions with payloads:
      - `firecrawl.error` — `{ url: string; reason: string }`
      - `kb.updated` — `{ entityId: string; entityType: KBEntityType; version: number }`
      - `knowledge_updated` — `{ experimentId: string; newEntryCount: number }`
      - `checkpoint.reached` — `{ stage: ApprovalCheckpointStage; pendingOutput: unknown }`
      - `checkpoint.approved` — `{ stage: ApprovalCheckpointStage }`
      - `checkpoint.rejected` — `{ stage: ApprovalCheckpointStage; instructions: string }`
      - `checkpoint.timeout` — `{ stage: ApprovalCheckpointStage }`
    - Implement typed `publish<T>(event: T)` and `subscribe<T>(eventName, handler)` with typed payloads
    - Support event acknowledgement with a configurable timeout (default 60 seconds)
    - Export a singleton `eventBus` instance for use across all agents
    - _Requirements: 11.6, 12.1–12.10_

- [ ] 5. Checkpoint — KB, RAG, and Event Bus compile and tests pass
  - Run `vitest --run tests/pbt/kb-merge.pbt.test.ts tests/pbt/rag-retrieval.pbt.test.ts`
  - Ensure all tests pass; resolve any compilation or assertion failures.
  - At this point Agent 2 and Agent 3 can replace their stubs with the real implementations.

---

## Notes
- All code is TypeScript. This agent's output is the **shared contract** — every public function signature must be stable before Agent 2 and Agent 3 merge.
- KB files stored on local filesystem; storage path configurable via environment variable `KB_STORAGE_PATH`.
- RAG vector store defaults to `hnswlib`; ChromaDB supported as an alternative via `RAG_BACKEND` env var.
- Local LLMs accessed via Ollama-compatible endpoints configured via `LLM_BASE_URL` environment variable.
- Every PBT sub-task must be tagged `// Feature: content-creator-ai, Property N: <text>` at the top of the test.

## Dependency Graph
```
Task 1 → Tasks 2.1, 2.2, 2.3, 3.1, 4.1
Tasks 2.1 + 2.2 + 2.3 → Task 2.4 (PBT)
Tasks 3.1 → Tasks 3.2, 3.3 (PBT)
Tasks 4.1 → Task 3.2 (event subscription)
Tasks 2.4 + 3.3 → Checkpoint 5
```
