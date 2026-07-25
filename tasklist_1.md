# Task List — Part 1 of 3: Foundation, Knowledge Layer, RAG, Context & Strategy Agents

## Assigned To: Cursor Agent 1

## Scope
This agent builds the entire platform foundation that all other agents depend on:
- Project scaffold, TypeScript types, and test infrastructure
- Knowledge Base (KB) storage, versioning, Markdown serialisation, and merge logic
- RAG vector store, embedding adapter, and re-index trigger
- Context_Agent (Firecrawl ingestion + Q&A pipeline)
- Strategy_Agent (goal validation, OpenCurriculum roadmap, hypothesis generation)

## Handoff Contract
When complete, the following must be available for Agent 2 and Agent 3:
- All TypeScript interfaces exported from `src/lib/content-creator-ai/types/index.ts`
- `writeKBEntity`, `readKBEntity`, `getVersionChain` working in `src/lib/content-creator-ai/kb/storage.ts`
- `semanticSearch` and `indexDocuments` working in `src/lib/content-creator-ai/rag/vectorstore.ts`
- `Context_Agent` accepting `ContextAgentInput` and returning `ContextAgentOutput`
- `Strategy_Agent` exposing goal validation, roadmap generation, and hypothesis generation functions
- All KB + RAG unit/PBT tests passing (`vitest --run tests/pbt/kb-merge.pbt.test.ts tests/pbt/rag-retrieval.pbt.test.ts tests/pbt/goal-validation.pbt.test.ts tests/pbt/hypothesis.pbt.test.ts tests/pbt/roadmap.pbt.test.ts`)

---

## Tasks

- [ ] 1. Project foundation — types, interfaces, and directory structure
  - Create `src/lib/content-creator-ai/` directory tree: `agents/`, `kb/`, `rag/`, `orchestration/`, `publishing/`, `integrations/`, `api/`, `types/`
  - Define all core TypeScript interfaces in `src/lib/content-creator-ai/types/index.ts`: `CompanyIdentity`, `KBVersion`, `MarketingGoal`, `SuccessMetric`, `AudiencePersona`, `Hypothesis`, `PostVariant`, `PostSlide`, `AnalyticsReport`, `ZernioMetrics`, `ExperimentSignificanceResult`, `ExperimentEvaluation`, `PostVariantOutcome`, `ContentPattern`, `TraceabilityChain`, `TraceabilityLink`, `PublishRecord`, `RoadmapEntry`, `ExperimentationRoadmap`, `RAGPassage`, `SocialPlatform`
  - Create `src/lib/content-creator-ai/types/enums.ts` for `SocialPlatform` union, `ApprovalCheckpointStage`, `OperatingMode`, `RetrievalScope`, `KBEntityType`
  - Set up Vitest config and `tests/pbt/` directory with placeholder files for all 12 PBT test files: `kb-merge.pbt.test.ts`, `rag-retrieval.pbt.test.ts`, `goal-validation.pbt.test.ts`, `persona.pbt.test.ts`, `platform-validation.pbt.test.ts`, `roadmap.pbt.test.ts`, `hypothesis.pbt.test.ts`, `post-variant.pbt.test.ts`, `analytics.pbt.test.ts`, `learning-agent.pbt.test.ts`, `workflow-engine.pbt.test.ts`, `traceability.pbt.test.ts`
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

  - [ ]* 2.3 Write property tests for KB storage and Markdown serialisation — `tests/pbt/kb-merge.pbt.test.ts`
    - **Property 3: KB edit always creates a version record with prior values** — Validates: Requirements 1.6, 2.2
    - **Property 4: Rejection never mutates the KB** — Validates: Requirements 1.7, 7.7
    - **Property 5: KB Markdown serialisation preserves required sections** — Validates: Requirement 2.1
    - **Property 6: Version history is append-only and monotonically ordered** — Validates: Requirements 2.2, 11.7

  - [ ] 2.4 Implement KB merge logic in `src/lib/content-creator-ai/kb/merge.ts`
    - Implement deep merge where `userProvidedValues` keys always overwrite scraped/existing values for conflicting fields
    - Preserve all non-conflicting existing KB fields unchanged
    - _Requirements: 1.2, 1.3_

  - [ ]* 2.5 Write property test for KB merge precedence — `tests/pbt/kb-merge.pbt.test.ts`
    - **Property 1: User-provided values always take precedence in KB merge** — Validates: Requirements 1.2, 1.3

- [ ] 3. RAG Layer
  - [ ] 3.1 Implement RAG vector store adapter in `src/lib/content-creator-ai/rag/vectorstore.ts`
    - Wrap local embedding model (`nomic-embed-text` via Ollama) and vector store (ChromaDB or `hnswlib`)
    - Implement `indexDocuments(docs: KBDocument[])` and `semanticSearch({ query, scope, k })` returning `RAGPassage[]`
    - Enforce retrieval scope filtering: `product_context`, `company_memory`, `experiment_history`, `audience_learning`
    - Return `[]` (not an error) when unavailable or zero results found
    - _Requirements: 2.3, 14.1, 14.2, 14.3_

  - [ ] 3.2 Implement RAG re-index trigger in `src/lib/content-creator-ai/rag/reindex.ts`
    - Subscribe to `kb.updated` events; trigger re-indexing of affected documents within 60 seconds
    - _Requirements: 14.4_

  - [ ]* 3.3 Write property tests for RAG retrieval — `tests/pbt/rag-retrieval.pbt.test.ts`
    - **Property 7: RAG returns at most k results, all from indexed content** — Validates: Requirement 2.3
    - **Property 29: RAG passage count is always min(available, 5)** — Validates: Requirements 14.2, 14.6

- [ ] 4. Checkpoint — Ensure KB and RAG layers compile and unit tests pass
  - Run `vitest --run tests/pbt/kb-merge.pbt.test.ts tests/pbt/rag-retrieval.pbt.test.ts`
  - Ensure all tests pass; resolve any compilation or assertion failures before continuing.

- [ ] 5. Firecrawl integration and Context_Agent
  - [ ] 5.1 Implement `FirecrawlAdapter` in `src/lib/content-creator-ai/integrations/firecrawl.ts`
    - Wrap Firecrawl REST API; enforce 20-page / 60-second limit via `AbortController`
    - On error: emit `firecrawl.error` event; return typed error result (non-blocking to other operations)
    - _Requirements: 1.1, 1.4_

  - [ ] 5.2 Implement Q&A pipeline in `src/lib/content-creator-ai/agents/context-agent/qa-pipeline.ts`
    - Stateful 10-prompt question chain (company name → industry → mission → products → brand voice → values → target outcome) using local LLM
    - Produce a complete `CompanyIdentity` object from user answers
    - _Requirements: 1.4_

  - [ ] 5.3 Implement `Context_Agent` in `src/lib/content-creator-ai/agents/context-agent/index.ts`
    - Wire `FirecrawlAdapter` → parse → KB merge → present `companySummary` to user
    - Accept `ContextAgentInput` (companyUrl, freeTextEnrichment, userEdits); return `ContextAgentOutput`
    - Implement edit path: call KB merge, write new KB version capturing prior values, expose version ID
    - Implement rejection path: discard draft without touching KB
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 5.4 Write unit tests for Context_Agent error paths
    - Firecrawl error → retry/Q&A options presented; non-blocking assertion
    - Q&A pipeline 10-step progression → complete `CompanyIdentity`
    - Rejection path → KB byte-for-byte identical before/after
    - _Requirements: 1.4, 1.7_

  - [ ]* 5.5 Write property test for company summary structure — `tests/pbt/kb-merge.pbt.test.ts`
    - **Property 2: Company summary always contains required structural fields** — Validates: Requirement 1.5

- [ ] 6. Strategy_Agent — goals, roadmap, and hypotheses
  - [ ] 6.1 Implement goal validation in `src/lib/content-creator-ai/agents/strategy-agent/goal-validation.ts`
    - Validate that a goal contains a non-empty `primaryObjective`, a `targetPlatform`, and at least one `SuccessMetric` with `numericTarget` and `timePeriod`
    - Return `{ valid: true }` or `{ valid: false, missingFields: string[] }`
    - _Requirements: 3.4, 3.5, 3.6_

  - [ ]* 6.2 Write property tests for goal validation — `tests/pbt/goal-validation.pbt.test.ts`
    - **Property 8: Generated goals always include objective, platform, and at least one measurable metric** — Validates: Requirements 3.1, 3.4
    - **Property 9: Goal validation rejects any goal missing required fields** — Validates: Requirements 3.4, 3.5, 3.6

  - [ ] 6.3 Implement `OpenCurriculumAdapter` in `src/lib/content-creator-ai/integrations/opencurriculum.ts`
    - Wrap OpenCurriculum API; input `{ goal, personas, durationWeeks: 2..12 }`; output `RoadmapEntry[]`
    - On error: notify user; allow retry with adjusted parameters
    - _Requirements: 6.1_

  - [ ] 6.4 Implement roadmap generation in `src/lib/content-creator-ai/agents/strategy-agent/roadmap.ts`
    - Enforce 2–12 week span and minimum 1 hypothesis slot per week
    - Block roadmap scheduling until KB storage of goal is confirmed
    - Store confirmed roadmap in KB; mark first hypothesis entry as active only after confirmed storage
    - Incorporate `Lessons_Learned` from KB if prior experiments exist; skip on first cycle
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.5 Write property test for roadmap structural invariants — `tests/pbt/roadmap.pbt.test.ts`
    - **Property 15: Generated roadmap satisfies structural invariants** — Validates: Requirements 6.1, 6.2

  - [ ] 6.6 Implement hypothesis generation in `src/lib/content-creator-ai/agents/strategy-agent/hypothesis.ts`
    - Query RAG for prior outcomes; require ≥ 3 results before generating (exception: first cycle)
    - Generate `Hypothesis` with all 7 required fields; validate each `SuccessMetric` has name + target value
    - Flag any hypothesis referencing a failed KB pattern; propose alternative
    - Implement modification path: save modified version + log original as versioned alternative with timestamp
    - Implement rejection path: discard draft, generate new hypothesis with revised constraints
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 6.7 Write property tests for hypothesis — `tests/pbt/hypothesis.pbt.test.ts`
    - **Property 16: Generated hypothesis always contains all seven required fields with valid success metrics** — Validates: Requirement 7.1
    - **Property 17: Hypothesis generation does not proceed with fewer than 3 prior outcomes** — Validates: Requirement 7.2
    - **Property 18: Hypothesis modification preserves original as a versioned alternative** — Validates: Requirement 7.6

---

## Notes
- Tasks marked `*` are property-based tests using `fast-check` (min 100 runs each). Do not skip unless building an MVP.
- All code is TypeScript; local LLMs accessed via Ollama-compatible endpoints configured via environment variables.
- KB files stored on local filesystem; storage path configurable via environment variables.
- RAG defaults to `hnswlib`; ChromaDB is an alternative.
- Every PBT sub-task must be tagged `// Feature: content-creator-ai, Property N: <text>` at the top of the test.
- The `kb.updated` event used by the RAG re-index trigger (task 3.2) will be emitted by the Event Bus — stub the event bus interface for now; Agent 3 will implement the full Event Bus.

## Dependency Graph (this agent's tasks)
```
Task 1 → Tasks 2.1, 2.2, 2.4
Tasks 2.1 + 2.2 + 2.4 → Tasks 2.3, 2.5, 3.1
Tasks 3.1 → Tasks 3.2, 3.3
Tasks 2.1 + 3.1 → Checkpoint 4
Checkpoint 4 → Tasks 5.1, 5.2, 6.1, 6.3
Tasks 5.1 + 5.2 → Task 5.3
Task 5.3 → Tasks 5.4, 5.5
Tasks 6.1 + 6.3 → Task 6.4
Task 6.4 → Tasks 6.5, 6.6
Task 6.6 → Task 6.7
```
