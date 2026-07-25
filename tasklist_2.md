# Task List — Part 2 of 3: Ingestion, Strategy, Audience, Workflow Engine, Traceability & API

## Assigned To: Cursor Agent 2

## Parallel Execution
This agent runs **in parallel with Agent 3**. No waiting required.

When Agent 1's KB/RAG/Event Bus are not yet merged, stub them locally:
```typescript
// stub — replace with Agent 1's implementation when merged
import { writeKBEntity, readKBEntity } from "../kb/storage";   // stub if not yet available
import { semanticSearch } from "../rag/vectorstore";           // stub if not yet available
import { eventBus } from "../orchestration/event-bus";         // stub if not yet available
```
Use the types from `src/lib/content-creator-ai/types/index.ts` — Agent 1 publishes these first and they are stable contracts.

## Scope
This agent owns the **ingestion, strategy, audience, orchestration, and API** vertical:
- Context_Agent (Firecrawl ingestion + Q&A pipeline)
- Strategy_Agent (goal validation, OpenCurriculum roadmap, hypothesis generation)
- Audience_Agent (persona research, overlap detection, merge, validation)
- Workflow Engine FSM + Approval Checkpoint manager (HITL / Full_Auto orchestration)
- Traceability layer (chain builder, human-edit recording, globally unique IDs)
- REST API + SSE endpoint (Next.js operator routes and real-time progress streaming)

---

## Tasks

- [x] 5. Firecrawl integration and Context_Agent
  - [x] 5.1 Implement `FirecrawlAdapter` in `src/lib/content-creator-ai/integrations/firecrawl.ts`
    - Wrap Firecrawl REST API; enforce 20-page / 60-second limit via `AbortController`
    - On error: emit `firecrawl.error` event via Event Bus; return typed error result; do NOT block other platform operations
    - _Requirements: 1.1, 1.4_

  - [x] 5.2 Implement Q&A pipeline in `src/lib/content-creator-ai/agents/context-agent/qa-pipeline.ts`
    - Stateful 10-prompt question chain using local LLM: company name → industry → mission → products → brand voice → values → target outcome
    - Produce a complete `CompanyIdentity` object from user answers
    - _Requirements: 1.4_

  - [x] 5.3 Implement `Context_Agent` in `src/lib/content-creator-ai/agents/context-agent/index.ts`
    - Wire `FirecrawlAdapter` → parse (up to 20 pages / 60 seconds) → KB merge → present `companySummary` to user
    - Accept `ContextAgentInput` (`companyUrl`, `freeTextEnrichment`, `userEdits`); return `ContextAgentOutput`
    - User-provided values take precedence over scraped values for conflicting fields
    - Edit path: call KB merge → write new KB version capturing prior values + timestamp → return new version ID
    - Rejection path: discard draft without writing to KB
    - On Firecrawl error: present user with choice — retry OR enter Q&A pipeline; non-blocking
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x]* 5.4 Write unit tests for Context_Agent error paths
    - Firecrawl error → retry/Q&A options presented; non-blocking assertion (other operations unaffected)
    - Q&A pipeline 10-step progression → complete `CompanyIdentity` with all fields populated
    - Rejection path → KB byte-for-byte identical before/after
    - _Requirements: 1.4, 1.7_

  - [x]* 5.5 Write property tests — `tests/pbt/kb-merge.pbt.test.ts`
    - **Property 2: Company summary always contains required structural fields** — Validates: Requirement 1.5

- [x] 6. Strategy_Agent — goals, roadmap, and hypotheses
  - [x] 6.1 Implement goal validation in `src/lib/content-creator-ai/agents/strategy-agent/goal-validation.ts`
    - Validate that a goal contains: non-empty `primaryObjective`, a `targetPlatform`, and at least one `SuccessMetric` with `numericTarget` and `timePeriod`
    - Return `{ valid: true }` or `{ valid: false, missingFields: string[] }`
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7_

  - [x]* 6.2 Write property tests for goal validation — `tests/pbt/goal-validation.pbt.test.ts`
    - **Property 8: Generated goals always include objective, platform, and at least one measurable metric** — Validates: Requirements 3.1, 3.4
    - **Property 9: Goal validation rejects any goal missing required fields** — Validates: Requirements 3.4, 3.5, 3.6

  - [x] 6.3 Implement `OpenCurriculumAdapter` in `src/lib/content-creator-ai/integrations/opencurriculum.ts`
    - Wrap OpenCurriculum API; input `{ goal, personas, durationWeeks: 2..12 }`; output `RoadmapEntry[]`
    - On error: notify user; allow retry with adjusted parameters
    - _Requirements: 6.1_

  - [x] 6.4 Implement roadmap generation in `src/lib/content-creator-ai/agents/strategy-agent/roadmap.ts`
    - Enforce 2–12 week span and minimum 1 hypothesis slot per week
    - Block roadmap scheduling (marking first hypothesis active) until KB storage of goal is confirmed
    - Store confirmed roadmap in KB; mark first hypothesis entry as `active` only after confirmed storage
    - First cycle: generate roadmap from KB context only, no `Lessons_Learned`
    - Subsequent cycles: retrieve `Lessons_Learned` from KB and incorporate into next roadmap
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 6.5 Write property test for roadmap structural invariants — `tests/pbt/roadmap.pbt.test.ts`
    - **Property 15: Generated roadmap satisfies structural invariants** — Validates: Requirements 6.1, 6.2

  - [x] 6.6 Implement hypothesis generation in `src/lib/content-creator-ai/agents/strategy-agent/hypothesis.ts`
    - Query RAG for prior outcomes; require ≥ 3 results before generating (exception: first cycle with zero prior results)
    - Generate `Hypothesis` with all 7 required fields (Hook, Angle, Core_Copy, Pain_Point, Theme, Visual_Theme, Success_Metrics); each `SuccessMetric` must have name + target value
    - Flag any hypothesis referencing a failed KB pattern (priority score = 0.0); propose alternative
    - Modification path: save modified version + log original as versioned alternative with original field values + timestamp
    - Rejection path: discard draft, generate new hypothesis with revised constraints
    - Approval path: attempt KB write; if KB write fails, allow approval to proceed and display a warning
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 6.7 Write property tests for hypothesis — `tests/pbt/hypothesis.pbt.test.ts`
    - **Property 16: Generated hypothesis always contains all seven required fields with valid success metrics** — Validates: Requirement 7.1
    - **Property 17: Hypothesis generation does not proceed with fewer than 3 prior outcomes** — Validates: Requirement 7.2
    - **Property 18: Hypothesis modification preserves original as a versioned alternative** — Validates: Requirement 7.6

- [x] 7. Audience_Agent
  - [x] 7.1 Implement persona validation in `src/lib/content-creator-ai/agents/audience-agent/persona-validation.ts`
    - Return `{ valid: true }` iff `icpDefinition` is non-empty AND `painPoints` has at least one entry
    - Otherwise return `{ valid: false, missingFields: string[] }`
    - _Requirements: 4.5_

  - [x] 7.2 Implement overlap detection in `src/lib/content-creator-ai/agents/audience-agent/overlap.ts`
    - Compute pairwise field-level Jaccard similarity across all string fields for every persona pair
    - Emit alert (via Event Bus or callback) when any pair reaches ≥ 0.6
    - Implement `mergePersonas(a, b)`: produce union of unique fields from both; re-validate merged result against minimum requirements
    - _Requirements: 4.1, 4.6, 4.7_

  - [x]* 7.3 Write property tests for persona — `tests/pbt/persona.pbt.test.ts`
    - **Property 10: Proposed persona sets are distinct (<60% pairwise overlap)** — Validates: Requirement 4.1
    - **Property 11: Persona validation rejects submissions missing required fields** — Validates: Requirement 4.5
    - **Property 12: Persona overlap alert fires exactly when overlap ≥ 60%** — Validates: Requirement 4.6
    - **Property 13: Merged persona is the union of unique fields from both sources** — Validates: Requirement 4.7

  - [x] 7.4 Implement `Audience_Agent` in `src/lib/content-creator-ai/agents/audience-agent/index.ts`
    - Propose 2–5 distinct personas within 30 seconds; enforce pairwise Jaccard < 0.6 between any pair
    - Wire persona accept (store in KB), edit (save edited + version prior), merge, and manual-create paths
    - Atomic persona write: if validation passes, write must succeed atomically (no partial writes)
    - Run audience research concurrently with goal KB write (do not block on goal storage)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 8. Workflow Engine and operating modes
  - [x] 8.1 Implement Approval_Checkpoint manager in `src/lib/content-creator-ai/orchestration/checkpoints.ts`
    - Support nine checkpoint stages: `ContextReview`, `GoalReview`, `AudienceReview`, `RoadmapReview`, `HypothesisReview`, `ContentReview`, `PublishingApproval`, `ExperimentReview`, `NextIterationPlanning`
    - Enforce minimum 1 enabled checkpoint in HITL mode; block disable of last active checkpoint with user-facing message
    - Auto-switch to `Full_Auto_Mode` if all checkpoints become disabled; notify user
    - 72-hour timeout per checkpoint → auto-escalate (emit `checkpoint.timeout` event) + notify user; preserve all pending outputs
    - Block rejection unless user provides free-text regeneration instructions OR a manual replacement
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10_

  - [x]* 8.2 Write property test for HITL checkpoint invariant — `tests/pbt/workflow-engine.pbt.test.ts`
    - **Property 27: HITL mode always has at least one enabled checkpoint** — Validates: Requirements 12.9, 12.10

  - [x] 8.3 Implement Workflow Engine state machine in `src/lib/content-creator-ai/orchestration/workflow-engine.ts`
    - FSM states in order:
      `ContextIngestion → GoalGeneration → AudienceResearch → PlatformSelection → RoadmapGeneration → HypothesisGeneration → ContentGeneration → PublishingQueue → AnalyticsIngestion → LearningUpdate`
    - `Full_Auto_Mode`: advance between states automatically without pausing for human input
    - `Human_In_The_Loop_Mode`: pause at each enabled `Approval_Checkpoint` and wait for user action
    - Mode switch: apply from next incomplete stage only; previously-approved outputs are unaffected
    - _Requirements: 12.1, 12.2, 12.3, 12.8_

  - [x]* 8.4 Write unit tests for workflow engine
    - HITL checkpoint 72h auto-escalation: mock timer advance to 72 hours; assert `checkpoint.timeout` event fired and user notified
    - Mode switch preserves prior approvals: switch mode mid-workflow; assert only future stages affected
    - Rejection blocked without instructions: attempt bare rejection; assert system blocks it
    - _Requirements: 12.6, 12.7, 12.8_

- [x] 9. Traceability layer
  - [x] 9.1 Implement `TraceabilityChain` builder in `src/lib/content-creator-ai/api/traceability.ts`
    - Build and incrementally update the chain for each `PostVariant` through its lifecycle:
      `company context version → marketing goal → audience persona → roadmap entry → hypothesis → post variant → published record → analytics report → experiment evaluation`
    - Each chain link must include the entity's globally unique ID and creation timestamp
    - Record human-edit events capturing: actor identity, timestamp, original AI-generated version, human-edited version
    - Return `{ chain, status: "in_progress" | "partial" | "complete" }` — return available links with `in_progress` marker for variants not yet fully evaluated
    - Assign UUID v4 globally unique IDs at creation time for: `Hypothesis`, `PostVariant`, `Experiment`, `ExperimentEvaluation`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x]* 9.2 Write property test for traceability — `tests/pbt/traceability.pbt.test.ts`
    - **Property 28: Traceability chain contains all required links for any Post_Variant** — Validates: Requirements 13.1, 13.2, 13.4, 13.5

  - [x]* 9.3 Write unit tests for traceability
    - Query in-progress variant: assert partial chain returned with `in_progress` status; assert response time ≤ 3 seconds
    - Human-edit event recorded in chain: assert all required fields present (actor, timestamp, original, edited)
    - _Requirements: 13.2, 13.4, 13.5_

- [x] 10. REST API and manual knowledge search
  - [x] 10.1 Implement Next.js API routes in `src/app/api/content-creator-ai/`
    - `POST /api/content-creator-ai/ingest` — trigger Context_Agent ingestion
    - `GET /api/content-creator-ai/knowledge-base` — read KB entity by ID and scope
    - `PUT /api/content-creator-ai/knowledge-base` — update KB entity (triggers versioned write)
    - `POST /api/content-creator-ai/search` — manual knowledge search (natural language; ≤ 3 seconds; up to 10 results)
    - `GET /api/content-creator-ai/traceability/[variantId]` — return traceability chain (≤ 3 seconds SLA)
    - `POST /api/content-creator-ai/platform-selection` — update active publishing targets for current experiment
    - `GET /api/content-creator-ai/workflow/status` — return current FSM state and operating mode
    - `POST /api/content-creator-ai/checkpoints/[stage]/[action]` — approve / reject (with instructions) / edit at a named checkpoint
    - _Requirements: 2.4, 5.2, 12.4, 13.2, 14.5_

  - [x] 10.2 Implement SSE endpoint in `src/app/api/content-creator-ai/events/route.ts`
    - Subscribe to Event Bus and stream to clients: workflow state transitions, checkpoint events, agent progress updates, error notifications
    - _Requirements: 12.3, 12.6_

  - [x]* 10.3 Write integration tests for API layer — `tests/integration/api.test.ts`
    - Manual search returns ≤ 10 results within 3 seconds
    - Traceability chain query returns within 3 seconds for a fully-evaluated variant
    - _Requirements: 13.2, 14.5_

---

## Notes
- Tasks marked `*` are property-based tests using `fast-check` (min 100 runs each).
- Stub KB/RAG/Event Bus with simple in-memory implementations to unblock development; swap for Agent 1's implementation when merged.
- Every PBT sub-task must be tagged `// Feature: content-creator-ai, Property N: <text>` at the top of the test.
- Goal storage is non-blocking: audience research in task 7.4 starts concurrently with the KB write in task 6.4.

## Dependency Graph (within this agent)
```
Task 5.1 + 5.2 → Task 5.3 → Tasks 5.4, 5.5
Task 6.1 → Task 6.2 (PBT)
Task 6.3 → Task 6.4 → Task 6.5 (PBT)
Task 6.6 → Task 6.7 (PBT)
Task 7.1 + 7.2 → Task 7.3 (PBT)
Tasks 7.1 + 7.2 → Task 7.4
Task 8.1 → Task 8.2 (PBT)
Task 8.1 + 8.3 → Task 8.4 (unit tests)
Task 9.1 → Tasks 9.2 (PBT), 9.3 (unit tests)
Tasks 8.3 + 9.1 → Tasks 10.1, 10.2
Tasks 10.1 → Task 10.3 (integration tests)
```
