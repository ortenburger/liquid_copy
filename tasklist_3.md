# Task List — Part 3 of 3: Learning Agent, Workflow Engine, Traceability, REST API, Integration Tests

## Assigned To: Cursor Agent 3

## Prerequisites (built by Agent 1 and Agent 2 — must be complete before starting)
- All TypeScript interfaces exported from `src/lib/content-creator-ai/types/index.ts`
- KB storage layer (`writeKBEntity`, `readKBEntity`, `getVersionChain`) operational
- RAG vector store adapter operational
- `Analytics_Agent` exposing `ingestMetrics(experimentId)` and accepting an `onLearningTrigger` callback
- `Publishing` queue with `enqueue`, `retry`, `getFailedVariants` operational

## Scope
This agent builds the intelligence loop, orchestration layer, and system-wide concerns:
- Learning_Agent (outcome classification, priority scoring, atomic KB update + event emission)
- Workflow Engine (typed Event Bus, FSM state machine, 9 Approval Checkpoints, HITL enforcement)
- Traceability layer (full chain builder, human-edit recording, globally unique IDs)
- REST API + SSE endpoint (Next.js operator routes and real-time progress streaming)
- Integration tests (all 9 external service scenarios)
- Full PBT suite wiring (confirm all 29 properties at 100 runs minimum)
- Final verification checkpoint

---

## Tasks

- [ ] 12. Learning_Agent
  - [ ] 12.1 Implement outcome classification in `src/lib/content-creator-ai/agents/learning-agent/classify.ts`
    - Classify each `PostVariant` outcome using the following thresholds:
      - `exceeded_expectations`: observed > target × 1.20
      - `met_expectations`: target × 0.80 ≤ observed ≤ target × 1.20
      - `below_expectations`: target × 0.50 ≤ observed < target × 0.80
      - `failed`: observed < target × 0.50
    - _Requirements: 11.2_

  - [ ] 12.2 Implement `ContentPattern` priority scoring in `src/lib/content-creator-ai/agents/learning-agent/patterns.ts`
    - Winning patterns: assign recency-weighted `priorityScore > 0.0`
    - Failed patterns: assign `priorityScore = 0.0` exactly
    - Monotonically-incrementing version numbers per `experimentId` (integer sequence counter)
    - _Requirements: 11.4, 11.5, 11.7_

  - [ ] 12.3 Implement atomic KB update + event emission in `src/lib/content-creator-ai/agents/learning-agent/atomic-update.ts`
    - Wrap KB write and `knowledge_updated` event emission as a single logical transaction:
      - If KB write fails: do not emit event; log failure
      - If event emission fails after ≤ 3 retries (60-second acknowledgement window each): roll back KB write; log failure with `Experiment_ID`
    - Never delete or overwrite historical experiment records; all updates are additive
    - _Requirements: 11.3, 11.6, 11.7_

  - [ ] 12.4 Implement `Learning_Agent` in `src/lib/content-creator-ai/agents/learning-agent/index.ts`
    - Accept completed experiment results (all `PostVariant`s have final `Analytics_Report` AND Experiment status = `"completed"`)
    - Produce `ExperimentEvaluation` containing: outcome classifications, winning patterns, failed patterns, audience learnings, hook performance data
    - Each `ExperimentEvaluation` version record must include: `Experiment_ID`, `Evaluation_Timestamp`, `classification` per variant, pattern attributes
    - Wire classification (12.1), priority scoring (12.2), and atomic update (12.3)
    - Wire into `Analytics_Agent`'s `onLearningTrigger` callback (connects Agent 2's analytics output to this agent's learning input)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 12.5 Write property tests for Learning_Agent — `tests/pbt/learning-agent.pbt.test.ts`
    - **Property 24: Evaluation version records always contain all required fields** — Validates: Requirement 11.3
    - **Property 25: Priority scores respect the winning/failed rule** — Validates: Requirements 11.4, 11.5
    - **Property 26: KB update and event emission are atomic** — Validates: Requirement 11.6

- [ ] 13. Workflow Engine and operating modes
  - [ ] 13.1 Implement the Event Bus in `src/lib/content-creator-ai/orchestration/event-bus.ts`
    - Typed event definitions: `firecrawl.error`, `kb.updated`, `knowledge_updated`, `checkpoint.reached`, `checkpoint.approved`, `checkpoint.rejected`, `checkpoint.timeout`
    - Implement publish/subscribe with typed payloads
    - Support event acknowledgement within a configurable timeout (default 60 seconds for `knowledge_updated`)
    - This event bus also resolves the stub used by Agent 1's RAG re-index trigger (`kb.updated`) — ensure backward compatibility
    - _Requirements: 11.6, 12.1–12.10_

  - [ ] 13.2 Implement Approval_Checkpoint manager in `src/lib/content-creator-ai/orchestration/checkpoints.ts`
    - Support nine checkpoint stages: `ContextReview`, `GoalReview`, `AudienceReview`, `RoadmapReview`, `HypothesisReview`, `ContentReview`, `PublishingApproval`, `ExperimentReview`, `NextIterationPlanning`
    - Enforce minimum 1 enabled checkpoint in HITL mode; block disable of last active checkpoint with user-facing message
    - Auto-switch to `Full_Auto_Mode` if all checkpoints become disabled via a bulk-disable bypass; notify user
    - Implement 72-hour timeout per checkpoint → auto-escalate + notify user; preserve all pending outputs
    - Block rejection at a checkpoint unless user provides free-text regeneration instructions OR a manual replacement
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10_

  - [ ]* 13.3 Write property test for HITL checkpoint invariant — `tests/pbt/workflow-engine.pbt.test.ts`
    - **Property 27: HITL mode always has at least one enabled checkpoint** — Validates: Requirements 12.9, 12.10

  - [ ] 13.4 Implement Workflow Engine state machine in `src/lib/content-creator-ai/orchestration/workflow-engine.ts`
    - Implement the FSM with these states in order:
      `ContextIngestion → GoalGeneration → AudienceResearch → PlatformSelection → RoadmapGeneration → HypothesisGeneration → ContentGeneration → PublishingQueue → AnalyticsIngestion → LearningUpdate`
    - `Full_Auto_Mode`: advance between states without pausing for human input
    - `Human_In_The_Loop_Mode`: pause at each enabled `Approval_Checkpoint` before advancing
    - Mode switch semantics: apply from next incomplete stage only; previously-approved outputs are unaffected
    - _Requirements: 12.1, 12.2, 12.3, 12.8_

  - [ ]* 13.5 Write unit tests for workflow engine
    - HITL checkpoint 72-hour auto-escalation: use mock timer to advance 72 hours; assert auto-escalation event fired and user notified
    - Mode switch preserves prior approvals: switch mode mid-workflow; assert only future stages affected
    - Rejection blocked without instructions: attempt bare rejection; assert system rejects the rejection
    - _Requirements: 12.6, 12.7, 12.8_

- [ ] 14. Traceability layer
  - [ ] 14.1 Implement `TraceabilityChain` builder in `src/lib/content-creator-ai/api/traceability.ts`
    - Build and incrementally update the chain for each `PostVariant` through its full lifecycle:
      `company context version → marketing goal → audience persona → roadmap entry → hypothesis → post variant → published record → analytics report → experiment evaluation`
    - Each chain link must include the entity's globally unique ID and creation timestamp
    - Record human-edit events with: actor identity, timestamp, original AI-generated version, human-edited version
    - Return `{ chain, status: "in_progress" | "partial" | "complete" }` — return available links with `in_progress` marker for variants not yet fully evaluated
    - Assign globally unique IDs (UUID v4) at creation time for: `Hypothesis`, `PostVariant`, `Experiment`, `ExperimentEvaluation`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 14.2 Write property test for traceability — `tests/pbt/traceability.pbt.test.ts`
    - **Property 28: Traceability chain contains all required links for any Post_Variant** — Validates: Requirements 13.1, 13.2, 13.4, 13.5

  - [ ]* 14.3 Write unit tests for traceability
    - Query in-progress variant: assert partial chain returned with `in_progress` status; assert response time ≤ 3 seconds
    - Human-edit event recorded in chain: assert all required fields (actor, timestamp, original, edited) present
    - _Requirements: 13.2, 13.4, 13.5_

- [ ] 15. REST API and manual knowledge search
  - [ ] 15.1 Implement Next.js API routes for operator interactions in `src/app/api/content-creator-ai/`
    - `POST /api/content-creator-ai/ingest` — trigger Context_Agent ingestion
    - `GET /api/content-creator-ai/knowledge-base` — read KB entity by ID and scope
    - `PUT /api/content-creator-ai/knowledge-base` — update KB entity (triggers versioned write)
    - `POST /api/content-creator-ai/search` — manual knowledge search (natural language query; ≤ 3 seconds response; up to 10 results)
    - `GET /api/content-creator-ai/traceability/[variantId]` — return traceability chain (≤ 3 seconds SLA)
    - `POST /api/content-creator-ai/platform-selection` — update active publishing targets for current experiment
    - `GET /api/content-creator-ai/workflow/status` — return current FSM state and operating mode
    - `POST /api/content-creator-ai/checkpoints/[stage]/[action]` — approve / reject (with instructions) / edit at a named checkpoint stage
    - _Requirements: 2.4, 5.2, 12.4, 13.2, 14.5_

  - [ ] 15.2 Implement SSE endpoint for real-time workflow progress in `src/app/api/content-creator-ai/events/route.ts`
    - Stream the following event types over Server-Sent Events: workflow state transitions, checkpoint reached/approved/rejected/timeout, agent progress updates, error notifications
    - _Requirements: 12.3, 12.6_

  - [ ]* 15.3 Write integration tests for API layer — `tests/integration/api.test.ts`
    - Manual search returns ≤ 10 results within 3 seconds
    - Traceability chain query returns within 3 seconds for a fully-evaluated variant
    - _Requirements: 13.2, 14.5_

- [ ] 16. Checkpoint — Ensure full stack compiles, all existing tests pass, and smoke tests pass
  - Run smoke tests to verify:
    - Local LLM (Hatties / Lezion) reachable at configured Ollama endpoint
    - OpenCarousel Next.js app running at `localhost:3000`
    - Vector store (RAG) initialised and queryable
    - KB file storage directory writable with correct permissions
    - All 9 platform publishing adapters initialise without error
    - Zernio API credentials valid
  - Run `vitest --run` and ensure all unit, PBT, and integration tests pass.
  - Resolve any failures before proceeding to the final integration and wiring phase.

- [ ] 17. Integration tests and full PBT suite wiring
  - [ ] 17.1 Implement integration tests in `tests/integration/`
    - Firecrawl full scrape round-trip — verify KB populated with mission, products, brand voice — Requirements 1.1, 1.2
    - RAG query latency ≤ 3s at 10k chunks — seed index with 10k chunks, time `semanticSearch` — Requirement 2.4
    - RAG re-index within 60s after KB write — write entity, assert index updated within 60s — Requirement 14.4
    - OpenCarousel carousel → PNG export — full 5-step flow, assert ZIP returned — Requirements 8.2, 8.3
    - Zernio analytics polling on observation window expiry — mock timer advance, assert `ZernioAdapter` queries Zernio — Requirements 10.1, 10.2
    - OpenCurriculum roadmap generation end-to-end — assert `RoadmapEntry[]` with ≥ 1 hypothesis per week — Requirement 6.1
    - Publishing retry with platform API mock — mock platform API to fail 3 times then succeed; assert correct backoff intervals — Requirement 9.5
    - `knowledge_updated` event acknowledgement within 60s — trigger Learning_Agent KB update; assert event acknowledged — Requirement 11.6
    - Traceability chain query latency ≤ 3s — assert response time for a complete chain — Requirement 13.2
    - _Requirements: 1.1, 1.2, 2.4, 6.1, 8.2, 8.3, 9.5, 10.1, 10.2, 11.6, 13.2, 14.4_

  - [ ] 17.2 Wire all PBT files and confirm 100-run minimum per property
    - Open each of the 12 PBT test files under `tests/pbt/` and ensure:
      - Every `fc.assert` call uses `{ numRuns: 100 }` in the options object
      - Every test has the tag `// Feature: content-creator-ai, Property N: <property_text>` at the top
    - Run `vitest --run tests/pbt` and fix any compilation or assertion failures
    - Confirm all 29 properties are represented:
      - Properties 1–6: `kb-merge.pbt.test.ts`
      - Properties 7, 29: `rag-retrieval.pbt.test.ts`
      - Properties 8–9: `goal-validation.pbt.test.ts`
      - Properties 10–13: `persona.pbt.test.ts`
      - Property 14: `platform-validation.pbt.test.ts`
      - Property 15: `roadmap.pbt.test.ts`
      - Properties 16–18: `hypothesis.pbt.test.ts`
      - Properties 19–21: `post-variant.pbt.test.ts`
      - Properties 22–23: `analytics.pbt.test.ts`
      - Properties 24–26: `learning-agent.pbt.test.ts`
      - Property 27: `workflow-engine.pbt.test.ts`
      - Property 28: `traceability.pbt.test.ts`
    - _Requirements: All (via Properties 1–29)_

- [ ] 18. Final checkpoint — all tests pass and traceability is complete
  - Run full test suite `vitest --run`: smoke tests, unit tests, PBT suite (29 properties × 100 runs), integration tests (9 scenarios)
  - Verify every requirement (1–14) is covered by at least one passing test
  - Verify all 29 correctness properties have a corresponding passing PBT sub-task
  - Verify the full traceability chain can be retrieved for at least one `PostVariant` that has passed through the complete lifecycle

---

## Notes
- Tasks marked `*` are property-based tests using `fast-check` (min 100 runs each). Do not skip unless building an MVP.
- The Event Bus (task 13.1) replaces the stub that Agent 1 used in the RAG re-index trigger. Ensure `kb.updated` event wiring is backward-compatible with Agent 1's `reindex.ts`.
- The `Learning_Agent` (task 12.4) must be wired into Agent 2's `Analytics_Agent` via the `onLearningTrigger` callback — this is the cross-agent integration point.
- The SSE endpoint (task 15.2) should subscribe to the Event Bus and fan out events to connected clients.
- Every PBT sub-task must be tagged `// Feature: content-creator-ai, Property N: <text>` at the top of the test.

## Dependency Graph (this agent's tasks)
```
[Prerequisites from Agents 1 + 2] → Tasks 12.1, 12.2, 13.1
Tasks 12.1 + 12.2 → Task 12.3
Task 12.3 → Task 12.4
Task 12.4 → Task 12.5 (PBT)
Task 13.1 → Tasks 13.2, 13.4
Task 13.2 → Task 13.3 (PBT)
Tasks 13.2 + 13.4 → Task 13.5 (unit tests)
Tasks 12.4 + 13.4 → Task 14.1
Task 14.1 → Tasks 14.2 (PBT), 14.3 (unit tests)
Tasks 13.4 + 14.1 → Tasks 15.1, 15.2
Tasks 15.1 + 15.2 → Task 15.3 (integration tests)
Tasks 12.5 + 13.5 + 14.3 + 15.3 → Checkpoint 16
Checkpoint 16 → Tasks 17.1, 17.2
Tasks 17.1 + 17.2 → Final Checkpoint 18
```
