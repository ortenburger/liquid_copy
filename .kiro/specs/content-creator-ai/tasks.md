# Implementation Plan: AI-Powered Social Content Experimentation Platform

## Overview

Implement the `content-creator-ai` platform in TypeScript using the existing Next.js codebase. Tasks are ordered so foundational data models and the Knowledge Base come first, then the RAG layer, then each of the six agents, then orchestration, publishing, analytics, and finally cross-cutting concerns (traceability, operating modes, UI/API). Property-based tests use `fast-check` via Vitest, mirroring the file structure defined in the design document.

---

## Tasks

- [ ] 1. Project foundation — types, interfaces, and directory structure
  - Create `src/lib/content-creator-ai/` directory tree: `agents/`, `kb/`, `rag/`, `orchestration/`, `publishing/`, `integrations/`, `api/`, `types/`
  - Define all core TypeScript interfaces in `src/lib/content-creator-ai/types/index.ts`: `CompanyIdentity`, `KBVersion`, `MarketingGoal`, `SuccessMetric`, `AudiencePersona`, `Hypothesis`, `PostVariant`, `PostSlide`, `AnalyticsReport`, `ZernioMetrics`, `ExperimentSignificanceResult`, `ExperimentEvaluation`, `PostVariantOutcome`, `ContentPattern`, `TraceabilityChain`, `TraceabilityLink`, `PublishRecord`, `RoadmapEntry`, `ExperimentationRoadmap`, `RAGPassage`, `SocialPlatform`
  - Create `src/lib/content-creator-ai/types/enums.ts` for `SocialPlatform` union, `ApprovalCheckpointStage`, `OperatingMode`, `RetrievalScope`, `KBEntityType`
  - Set up Vitest config and `tests/pbt/` directory with placeholder files for all 12 PBT test files listed in the design
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
  - Ensure all tests pass, ask the user if questions arise.


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


- [ ] 7. Audience_Agent
  - [ ] 7.1 Implement persona validation in `src/lib/content-creator-ai/agents/audience-agent/persona-validation.ts`
    - Return `valid` iff `icpDefinition` is non-empty and `painPoints` has at least one entry; otherwise return `{ valid: false, missingFields: string[] }`
    - _Requirements: 4.5_

  - [ ] 7.2 Implement overlap detection in `src/lib/content-creator-ai/agents/audience-agent/overlap.ts`
    - Compute pairwise field-level Jaccard similarity across all string fields
    - Emit alert when any pair reaches ≥ 0.6
    - Implement `mergePersonas(a, b)`: union of unique fields; re-validate merged result
    - _Requirements: 4.1, 4.6, 4.7_

  - [ ]* 7.3 Write property tests for persona — `tests/pbt/persona.pbt.test.ts`
    - **Property 10: Proposed persona sets are distinct (<60% pairwise overlap)** — Validates: Requirement 4.1
    - **Property 11: Persona validation rejects submissions missing required fields** — Validates: Requirement 4.5
    - **Property 12: Persona overlap alert fires exactly when overlap ≥ 60%** — Validates: Requirement 4.6
    - **Property 13: Merged persona is the union of unique fields from both sources** — Validates: Requirement 4.7

  - [ ] 7.4 Implement `Audience_Agent` in `src/lib/content-creator-ai/agents/audience-agent/index.ts`
    - Propose 2–5 distinct personas within 30 seconds; enforce pairwise Jaccard < 0.6
    - Wire persona accept, edit (version prior), merge, and manual-create paths
    - Implement atomic persona write (reject partial writes); start concurrently with goal KB write
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_


- [ ] 8. Platform selection and Content_Agent
  - [ ] 8.1 Implement platform constraint validators in `src/lib/content-creator-ai/publishing/platform-validators.ts`
    - For each of the 9 platforms, validate: aspect ratio, caption length, hashtag count, CTA placement
    - Flag violations with structured error output; allow advancement only if ≥ 1 platform passes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 8.2 Write property test for platform content validation — `tests/pbt/platform-validation.pbt.test.ts`
    - **Property 14: Platform content validation flags all constraint violations** — Validates: Requirement 5.3

  - [ ] 8.3 Implement `Content_Agent` with OpenCarousel integration in `src/lib/content-creator-ai/agents/content-agent/index.ts`
    - Implement 5-step OpenCarousel flow: POST `/api/carousels` → PUT `/api/brand` + POST `/api/chat` → slide generation → PUT caption/hashtags → POST export
    - Map `SocialPlatform` to correct aspect ratio per design table
    - Retrieve brand voice, tone, visual theme history from RAG; tag variant as `"generated_without_brand_context"` if RAG unavailable
    - Generate 2–5 `PostVariant` objects per platform
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [ ] 8.4 Implement `PostVariant` validation and discard logic in `src/lib/content-creator-ai/agents/content-agent/variant-validation.ts`
    - Accept variant iff ≥ 1 slide present, every slide has non-empty image or text, caption is non-empty; CTA absence is allowed
    - Discard invalid variants; preserve all valid; notify user of discarded count
    - Implement human-edit path: tag `"human_edited"`, cap `regenerationRetryCount` at 3
    - _Requirements: 8.4, 8.5, 8.8, 8.9_

  - [ ]* 8.5 Write property tests for post variant — `tests/pbt/post-variant.pbt.test.ts`
    - **Property 19: Post_Variant count per platform is always between 2 and 5** — Validates: Requirement 8.1
    - **Property 20: Post_Variant validation accepts exactly the correct structure** — Validates: Requirement 8.4
    - **Property 21: Human-edited variants are always tagged and retry count is bounded** — Validates: Requirement 8.9

- [ ] 9. Checkpoint — Ensure all agent implementations compile and core unit tests pass
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 10. Publishing layer
  - [ ] 10.1 Implement the 9 social platform publishing adapters in `src/lib/content-creator-ai/publishing/adapters/`
    - One adapter file per platform: `instagram.ts`, `tiktok.ts`, `linkedin.ts`, `facebook.ts`, `pinterest.ts`, `etsy.ts`, `x.ts`, `threads.ts`, `youtube-shorts.ts`
    - Each adapter implements a shared `PlatformAdapter` interface with `publish(variant: PostVariant): Promise<PublishRecord>`
    - _Requirements: 5.1, 9.1, 9.2_

  - [ ] 10.2 Implement publishing queue and retry logic in `src/lib/content-creator-ai/publishing/queue.ts`
    - Queue each approved `PostVariant` with a default schedule of next available slot within 24 hours
    - On API error: retry with exponential backoff — 1 min, 2 min, 4 min (4 total attempts); mark as `failed` after final attempt
    - On failure: set `retainUntil = now + 30 days`; notify user; allow manual retry/reschedule within retention window
    - Record `publishedAt`, `platform`, `postVariantId`, `hypothesisId` as linked experiment record on success
    - _Requirements: 9.1, 9.2, 9.5, 9.6_

  - [ ]* 10.3 Write unit tests for publishing retry schedule
    - Verify 1 min → 2 min → 4 min backoff intervals and `failed` state after 4 total attempts
    - Verify 30-day retention period is set on failure
    - _Requirements: 9.5, 9.6_


- [ ] 11. Analytics_Agent
  - [ ] 11.1 Implement `ZernioAdapter` in `src/lib/content-creator-ai/integrations/zernio.ts`
    - Query Zernio after `observationWindowDays` (1–30, default 7) from publish timestamp
    - Detect partial data (< 5 of 9 metrics returned); schedule retry after 1 hour; notify user after 3 failed retries
    - Return typed `ZernioMetrics` or structured error
    - _Requirements: 10.1, 10.5_

  - [ ] 11.2 Implement statistical significance computation in `src/lib/content-creator-ai/agents/analytics-agent/significance.ts`
    - Implement Welch's t-test on `engagementRate` across all variants; threshold p < 0.05
    - Winner selection: strictly-highest `engagementRate` when p < 0.05 → `statistically_significant`; otherwise highest absolute → `highest_absolute`
    - Record inconclusive result when significance not reached within observation window
    - _Requirements: 10.3, 10.4, 10.7_

  - [ ] 11.3 Implement `Analytics_Agent` in `src/lib/content-creator-ai/agents/analytics-agent/index.ts`
    - Wire Zernio polling → associate metrics with `PostVariant` and `Hypothesis` IDs → compute significance → trigger `Learning_Agent`
    - Trigger `Learning_Agent` on completion regardless of conclusive/inconclusive outcome
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7_

  - [ ]* 11.4 Write property tests for analytics — `tests/pbt/analytics.pbt.test.ts`
    - **Property 22: Outcome classification always matches the defined thresholds** — Validates: Requirement 11.2
    - **Property 23: Winner identification always uses engagement rate as primary comparator** — Validates: Requirements 10.3, 10.4


- [ ] 12. Learning_Agent
  - [ ] 12.1 Implement outcome classification in `src/lib/content-creator-ai/agents/learning-agent/classify.ts`
    - `exceeded_expectations`: observed > target × 1.20
    - `met_expectations`: target × 0.80 ≤ observed ≤ target × 1.20
    - `below_expectations`: target × 0.50 ≤ observed < target × 0.80
    - `failed`: observed < target × 0.50
    - _Requirements: 11.2_

  - [ ] 12.2 Implement `ContentPattern` priority scoring in `src/lib/content-creator-ai/agents/learning-agent/patterns.ts`
    - Winning patterns: `priorityScore > 0.0` (recency-weighted)
    - Failed patterns: `priorityScore = 0.0` exactly
    - Monotonically-incrementing version numbers per `experimentId`
    - _Requirements: 11.4, 11.5, 11.7_

  - [ ] 12.3 Implement atomic KB update + event emission in `src/lib/content-creator-ai/agents/learning-agent/atomic-update.ts`
    - Wrap KB write and `knowledge_updated` event emission as a single logical transaction
    - If event emission fails after ≤ 3 retries (60 s acknowledgement window each): roll back KB write and log failure
    - If KB write fails: do not emit event
    - Never delete or overwrite historical experiment records; all updates are additive
    - _Requirements: 11.3, 11.6, 11.7_

  - [ ] 12.4 Implement `Learning_Agent` in `src/lib/content-creator-ai/agents/learning-agent/index.ts`
    - Accept completed experiment results; produce `ExperimentEvaluation`; update KB with winning patterns, failed patterns, audience learnings, hook performance data
    - Wire classification, pattern scoring, and atomic update functions
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 12.5 Write property tests for Learning_Agent — `tests/pbt/learning-agent.pbt.test.ts`
    - **Property 24: Evaluation version records always contain all required fields** — Validates: Requirement 11.3
    - **Property 25: Priority scores respect the winning/failed rule** — Validates: Requirements 11.4, 11.5
    - **Property 26: KB update and event emission are atomic** — Validates: Requirement 11.6


- [ ] 13. Workflow Engine and operating modes
  - [ ] 13.1 Implement the Event Bus in `src/lib/content-creator-ai/orchestration/event-bus.ts`
    - Typed events: `firecrawl.error`, `kb.updated`, `knowledge_updated`, `checkpoint.reached`, `checkpoint.approved`, `checkpoint.rejected`, `checkpoint.timeout`
    - Implement publish/subscribe with typed payloads; support event acknowledgement within configurable timeout
    - _Requirements: 11.6, 12.1–12.10_

  - [ ] 13.2 Implement Approval_Checkpoint manager in `src/lib/content-creator-ai/orchestration/checkpoints.ts`
    - Nine checkpoint stages: `ContextReview`, `GoalReview`, `AudienceReview`, `RoadmapReview`, `HypothesisReview`, `ContentReview`, `PublishingApproval`, `ExperimentReview`, `NextIterationPlanning`
    - Enforce minimum 1 enabled checkpoint in HITL mode; block disable of last active checkpoint
    - Auto-switch to `Full_Auto_Mode` if all checkpoints become disabled; notify user
    - Implement 72-hour timeout → auto-escalate + notify; preserve pending outputs
    - Block rejection without free-text regeneration instructions or manual replacement
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10_

  - [ ]* 13.3 Write property test for HITL checkpoint invariant — `tests/pbt/workflow-engine.pbt.test.ts`
    - **Property 27: HITL mode always has at least one enabled checkpoint** — Validates: Requirements 12.9, 12.10

  - [ ] 13.4 Implement Workflow Engine state machine in `src/lib/content-creator-ai/orchestration/workflow-engine.ts`
    - Implement the FSM states from the design: `ContextIngestion → GoalGeneration → AudienceResearch → PlatformSelection → RoadmapGeneration → HypothesisGeneration → ContentGeneration → PublishingQueue → AnalyticsIngestion → LearningUpdate`
    - In `Full_Auto_Mode`: advance without pausing for human input
    - In `Human_In_The_Loop_Mode`: pause at each enabled `Approval_Checkpoint`
    - Mode switch: apply from next incomplete stage only; previously-approved outputs unaffected
    - _Requirements: 12.1, 12.2, 12.3, 12.8_

  - [ ]* 13.5 Write unit tests for workflow engine
    - HITL checkpoint 72h auto-escalation (mock timer)
    - Mode switch preserves prior approvals; applies only to next incomplete stage
    - Rejection blocked without regeneration instructions
    - _Requirements: 12.6, 12.7, 12.8_


- [ ] 14. Traceability layer
  - [ ] 14.1 Implement `TraceabilityChain` builder in `src/lib/content-creator-ai/api/traceability.ts`
    - Build and update the chain for each `PostVariant` through its lifecycle: company context version → goal → persona → roadmap entry → hypothesis → post variant → published record → analytics report → evaluation
    - Record human-edit events with actor identity, timestamp, original AI version, and human-edited version
    - Return `{ chain, status: "in_progress" | "partial" | "complete" }` with available links for in-progress variants
    - Assign globally unique IDs at creation time for Hypothesis, PostVariant, Experiment, ExperimentEvaluation
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 14.2 Write property test for traceability — `tests/pbt/traceability.pbt.test.ts`
    - **Property 28: Traceability chain contains all required links for any Post_Variant** — Validates: Requirements 13.1, 13.2, 13.4, 13.5

  - [ ]* 14.3 Write unit tests for traceability
    - Query in-progress variant returns partial chain with `in_progress` status within 3 seconds
    - Human-edit event is recorded in chain with all required fields
    - _Requirements: 13.2, 13.4, 13.5_

- [ ] 15. REST API and manual knowledge search
  - [ ] 15.1 Implement Next.js API routes for operator interactions in `src/app/api/content-creator-ai/`
    - `POST /api/content-creator-ai/ingest` — trigger Context_Agent ingestion
    - `GET/PUT /api/content-creator-ai/knowledge-base` — direct KB read/update
    - `POST /api/content-creator-ai/search` — manual knowledge search (natural language, ≤ 3s, up to 10 results)
    - `GET /api/content-creator-ai/traceability/[variantId]` — traceability chain query (≤ 3s SLA)
    - `POST /api/content-creator-ai/platform-selection` — update active publishing targets
    - `GET /api/content-creator-ai/workflow/status` — current FSM state and mode
    - `POST /api/content-creator-ai/checkpoints/[stage]/[action]` — approve/reject/edit at a checkpoint
    - _Requirements: 2.4, 5.2, 12.4, 13.2, 14.5_

  - [ ] 15.2 Implement SSE endpoint for real-time workflow progress in `src/app/api/content-creator-ai/events/route.ts`
    - Stream workflow state transitions, checkpoint events, agent progress updates, and error notifications
    - _Requirements: 12.3, 12.6_

  - [ ]* 15.3 Write integration tests for API layer
    - Manual search returns ≤ 10 results within 3 seconds
    - Traceability chain query returns within 3 seconds
    - _Requirements: 13.2, 14.5_

- [ ] 16. Checkpoint — Ensure full stack compiles, all existing tests pass, and smoke tests pass
  - Verify local LLM reachable, OpenCarousel at `localhost:3000`, vector store initialised, KB directory writable, all 9 platform adapters initialise without error, Zernio credentials valid
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 17. Integration tests and full PBT suite wiring
  - [ ] 17.1 Implement integration tests in `tests/integration/`
    - Firecrawl full scrape round-trip — Requirements 1.1, 1.2
    - RAG query latency ≤ 3s at 10k chunks — Requirement 2.4
    - RAG re-index within 60s after KB write — Requirement 14.4
    - OpenCarousel carousel → PNG export — Requirements 8.2, 8.3
    - Zernio analytics polling on observation window expiry — Requirements 10.1, 10.2
    - OpenCurriculum roadmap generation end-to-end — Requirement 6.1
    - Publishing retry with platform API mock — Requirement 9.5
    - `knowledge_updated` event acknowledgement within 60s — Requirement 11.6
    - Traceability chain query latency ≤ 3s — Requirement 13.2
    - _Requirements: 1.1, 1.2, 2.4, 6.1, 8.2, 8.3, 9.5, 10.1, 10.2, 11.6, 13.2, 14.4_

  - [ ] 17.2 Wire all PBT files and confirm 100-run minimum per property
    - Ensure all 12 PBT test files under `tests/pbt/` export tests with `{ numRuns: 100 }` config
    - Add `// Feature: content-creator-ai, Property N: <property_text>` tag to every test
    - Run `vitest --run tests/pbt` and fix any compilation or assertion failures
    - _Requirements: All (via Properties 1–29)_

- [ ] 18. Final checkpoint — all tests pass and traceability is complete
  - Run full test suite (`vitest --run`): smoke tests, unit tests, PBT suite, integration tests
  - Verify every requirement (1–14) is covered by at least one passing test
  - Verify all 29 correctness properties have a corresponding PBT sub-task
  - Ensure all tests pass, ask the user if questions arise.


---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all non-starred sub-tasks must be implemented.
- All code is TypeScript; property-based tests use `fast-check` with `vitest` (minimum 100 runs per property).
- PBT test files follow the naming convention from the design: `tests/pbt/{domain}.pbt.test.ts`.
- Every PBT sub-task must be tagged `// Feature: content-creator-ai, Property N: <text>`.
- The OpenCarousel instance is expected at `localhost:3000` during development.
- Local LLMs (Hatties / Lezion) are accessed via Ollama-compatible endpoints configured via environment variables.
- KB files are stored on the local filesystem; the storage path is configurable via environment variables.
- The RAG vector store defaults to `hnswlib` for local-first deployment; ChromaDB is supported as an alternative.
- All external integrations have typed adapters with retry/fallback contracts as specified in the design Error Handling section.
- Checkpoints ensure incremental validation and surface integration issues early.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.4"] },
    { "id": 2, "tasks": ["2.3", "2.5", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "5.1", "5.2", "6.1", "7.1", "7.2"] },
    { "id": 4, "tasks": ["5.3", "6.2", "7.3", "8.1"] },
    { "id": 5, "tasks": ["5.4", "5.5", "6.3", "7.4", "8.2"] },
    { "id": 6, "tasks": ["6.4", "8.3"] },
    { "id": 7, "tasks": ["6.5", "6.6", "8.4"] },
    { "id": 8, "tasks": ["6.7", "8.5", "10.1", "11.1", "12.1", "12.2"] },
    { "id": 9, "tasks": ["10.2", "11.2", "12.3", "13.1"] },
    { "id": 10, "tasks": ["10.3", "11.3", "12.4", "13.2", "14.1"] },
    { "id": 11, "tasks": ["11.4", "12.5", "13.3", "13.4", "14.2"] },
    { "id": 12, "tasks": ["13.5", "14.3", "15.1"] },
    { "id": 13, "tasks": ["15.2", "15.3"] },
    { "id": 14, "tasks": ["17.1", "17.2"] }
  ]
}
```
