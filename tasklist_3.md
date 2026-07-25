# Task List — Part 3 of 3: Content Agent, Publishing, Analytics, Learning Agent, Integration Tests & PBT Wiring

## Assigned To: Cursor Agent 3

## Parallel Execution
This agent runs **in parallel with Agent 2**. No waiting required.

When Agent 1's KB/RAG/Event Bus are not yet merged, stub them locally:
```typescript
// stub — replace with Agent 1's implementation when merged
import { writeKBEntity, readKBEntity } from "../kb/storage";   // stub if not yet available
import { semanticSearch } from "../rag/vectorstore";           // stub if not yet available
import { eventBus } from "../orchestration/event-bus";         // stub if not yet available
```
Use the types from `src/lib/content-creator-ai/types/index.ts` — Agent 1 publishes these first and they are stable contracts.

## Scope
This agent owns the **content production, publishing, experimentation, and learning** vertical:
- Platform selection validators (9 social networks)
- Content_Agent (OpenCarousel 5-step integration, brand context via RAG, variant validation)
- Publishing layer (9 platform adapters, queue, exponential-backoff retry)
- Analytics_Agent (Zernio polling, Welch's t-test significance, winner identification)
- Learning_Agent (outcome classification, priority scoring, atomic KB update + event emission)
- Full integration test suite (9 external service scenarios)
- PBT suite wiring and final verification

---

## Tasks

- [ ] 11. Platform selection and Content_Agent
  - [ ] 11.1 Implement platform constraint validators in `src/lib/content-creator-ai/publishing/platform-validators.ts`
    - For each of the 9 platforms, implement a validator that checks: aspect ratio, caption length (characters), hashtag count, CTA placement
    - Use these constraints from the design:

      | Platform | Aspect Ratio | Caption limit | Hashtag limit |
      |---|---|---|---|
      | Instagram | 4:5 | 2,200 chars | ≤ 30 |
      | TikTok | 9:16 | 2,200 chars | ≤ 30 |
      | LinkedIn | 1:1 or 4:5 | 3,000 chars | ≤ 30 |
      | Facebook | 1:1 or 4:5 | 63,206 chars | None |
      | Pinterest | 2:3 (use 4:5) | 500 chars | No strict limit |
      | Etsy | 1:1 | 300 chars | N/A |
      | X | 1:1 or 16:9 | 280 chars | ≤ 10 |
      | Threads | 1:1 | 500 chars | ≤ 10 |
      | YouTube Shorts | 9:16 | 5,000 chars | ≤ 15 |

    - Return structured violation errors per platform
    - Allow user to advance if ≥ 1 platform passes; block if ALL selected platforms fail
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 11.2 Write property test for platform content validation — `tests/pbt/platform-validation.pbt.test.ts`
    - **Property 14: Platform content validation flags all constraint violations** — Validates: Requirement 5.3

  - [ ] 11.3 Implement `Content_Agent` with OpenCarousel integration in `src/lib/content-creator-ai/agents/content-agent/index.ts`
    - Implement 5-step OpenCarousel flow against `localhost:3000`:
      1. `POST /api/carousels` — create carousel with name derived from Hypothesis ID; set aspect ratio per platform
      2. `PUT /api/brand` + `POST /api/chat` — apply Hypothesis fields (Hook, Angle, Visual_Theme, Core_Copy, CTA) and brand context retrieved from RAG
      3. Slide generation — 1–10 slides per variant as HTML body fragments
      4. `PUT /api/carousels/{id}` — set caption and hashtags
      5. `POST /api/carousels/{id}/export` — export as PNG ZIP
    - Map each `SocialPlatform` to the correct aspect ratio using the constraint table above
    - Retrieve brand voice, tone, and visual theme history from RAG and include as context inputs to OpenCarousel
    - If RAG is unavailable: proceed with Hypothesis fields only; tag each variant as `"generated_without_brand_context"`
    - Generate 2–5 `PostVariant` objects per platform per approved Hypothesis
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [ ] 11.4 Implement `PostVariant` validation and discard logic in `src/lib/content-creator-ai/agents/content-agent/variant-validation.ts`
    - Accept variant iff: ≥ 1 slide present AND every slide has non-empty image reference or non-empty text AND caption is non-empty
    - Explicit CTA is optional — its absence must NOT cause validation to fail
    - Discard invalid variants; preserve all valid variants; notify user of discarded count
    - Human-edit path: tag variant as `"human_edited"` in experiment record; cap `regenerationRetryCount` at 3
    - _Requirements: 8.4, 8.5, 8.8, 8.9_

  - [ ]* 11.5 Write property tests for post variant — `tests/pbt/post-variant.pbt.test.ts`
    - **Property 19: Post_Variant count per platform is always between 2 and 5** — Validates: Requirement 8.1
    - **Property 20: Post_Variant validation accepts exactly the correct structure** — Validates: Requirement 8.4
    - **Property 21: Human-edited variants are always tagged and retry count is bounded** — Validates: Requirement 8.9

- [ ] 12. Publishing layer
  - [ ] 12.1 Implement the 9 social platform publishing adapters in `src/lib/content-creator-ai/publishing/adapters/`
    - One adapter file per platform: `instagram.ts`, `tiktok.ts`, `linkedin.ts`, `facebook.ts`, `pinterest.ts`, `etsy.ts`, `x.ts`, `threads.ts`, `youtube-shorts.ts`
    - Each adapter implements a shared `PlatformAdapter` interface: `publish(variant: PostVariant): Promise<PublishRecord>`
    - If platform API credentials are unavailable, implement a stub that throws a descriptive `NotImplementedError` so the retry/failure path remains testable
    - _Requirements: 5.1, 9.1, 9.2_

  - [ ] 12.2 Implement publishing queue and retry logic in `src/lib/content-creator-ai/publishing/queue.ts`
    - Queue each approved `PostVariant` with default schedule = next available slot within 24 hours (user may override)
    - Retry schedule on API error (4 total attempts):
      - Attempt 1: immediate
      - Attempt 2: +1 minute
      - Attempt 3: +2 minutes
      - Attempt 4: +4 minutes (final)
    - After 4 failed attempts: mark as `failed`; set `retainUntil = now + 30 days`; notify user; allow manual retry/reschedule
    - On success: record `publishedAt`, `platform`, `postVariantId`, `hypothesisId` as linked experiment record
    - In `Human_In_The_Loop_Mode`: pause at `PublishingApproval` checkpoint only when queue is non-empty; skip if queue is empty
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]* 12.3 Write unit tests for publishing retry schedule
    - Verify attempt schedule: immediate → +1 min → +2 min → +4 min; assert `failed` state after 4 attempts
    - Verify 30-day retention: `retainUntil = now + 30 days` set on failure
    - Verify empty queue does not trigger HITL approval prompt
    - _Requirements: 9.4, 9.5, 9.6_

- [ ] 13. Analytics_Agent
  - [ ] 13.1 Implement `ZernioAdapter` in `src/lib/content-creator-ai/integrations/zernio.ts`
    - Poll Zernio after `observationWindowDays` (configurable 1–30, default 7) from publish timestamp
    - Required metrics: impressions, CTR, saves, shares, comments, watch_time, conversions, engagement_rate, follower_growth
    - Partial data detection: if fewer than 5 of 9 metrics returned → log error, retry after 1 hour, notify user after 3 failed retries
    - Return typed `ZernioMetrics` or structured error
    - _Requirements: 10.1, 10.5_

  - [ ] 13.2 Implement statistical significance computation in `src/lib/content-creator-ai/agents/analytics-agent/significance.ts`
    - Implement Welch's t-test on `engagementRate` across all variants; significance threshold: p < 0.05
    - Winner selection:
      - One variant statistically dominates all others → `determinationMethod: "statistically_significant"`
      - p < 0.05 overall but no single dominant winner → highest absolute `engagementRate` wins → `determinationMethod: "highest_absolute"`
    - Observation window expires without significance → record as `inconclusive`
    - _Requirements: 10.3, 10.4, 10.7_

  - [ ] 13.3 Implement `Analytics_Agent` in `src/lib/content-creator-ai/agents/analytics-agent/index.ts`
    - Wire: Zernio polling → associate metrics with `PostVariant` ID + `Hypothesis` ID → compute significance → trigger Learning_Agent
    - Trigger Learning_Agent on completion regardless of conclusive or inconclusive outcome
    - Accept a `onLearningTrigger: (results: ExperimentResults) => void` callback in the constructor (wired to Learning_Agent in task 14.4)
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7_

  - [ ]* 13.4 Write property tests for analytics — `tests/pbt/analytics.pbt.test.ts`
    - **Property 22: Outcome classification always matches the defined thresholds** — Validates: Requirement 11.2
    - **Property 23: Winner identification always uses engagement rate as primary comparator** — Validates: Requirements 10.3, 10.4

- [ ] 14. Learning_Agent
  - [ ] 14.1 Implement outcome classification in `src/lib/content-creator-ai/agents/learning-agent/classify.ts`
    - Classify each `PostVariant` outcome:
      - `exceeded_expectations`: observed > target × 1.20
      - `met_expectations`: target × 0.80 ≤ observed ≤ target × 1.20
      - `below_expectations`: target × 0.50 ≤ observed < target × 0.80
      - `failed`: observed < target × 0.50
    - _Requirements: 11.2_

  - [ ] 14.2 Implement `ContentPattern` priority scoring in `src/lib/content-creator-ai/agents/learning-agent/patterns.ts`
    - Winning patterns: assign recency-weighted `priorityScore > 0.0`
    - Failed patterns: assign `priorityScore = 0.0` exactly
    - Monotonically-incrementing version numbers per `experimentId` (integer sequence counter)
    - _Requirements: 11.4, 11.5, 11.7_

  - [ ] 14.3 Implement atomic KB update + event emission in `src/lib/content-creator-ai/agents/learning-agent/atomic-update.ts`
    - KB write and `knowledge_updated` event emission are a single logical transaction:
      - KB write fails → do not emit event; log failure
      - Event emission fails (after ≤ 3 retries, 60s acknowledgement window each) → roll back KB write; log failure with `Experiment_ID`
    - Never delete or overwrite historical experiment records; all updates are additive
    - _Requirements: 11.3, 11.6, 11.7_

  - [ ] 14.4 Implement `Learning_Agent` in `src/lib/content-creator-ai/agents/learning-agent/index.ts`
    - Accept completed experiment results (all `PostVariant`s have final `Analytics_Report` AND Experiment status = `"completed"`)
    - Produce `ExperimentEvaluation` with: outcome classifications, winning patterns, failed patterns, audience learnings, hook performance data
    - Each version record must include: `Experiment_ID`, `Evaluation_Timestamp`, classification per variant, pattern attributes
    - Wire classification (14.1), priority scoring (14.2), and atomic update (14.3)
    - Provide `instance.handle(results)` method — wire into `Analytics_Agent`'s `onLearningTrigger` callback (task 13.3)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 14.5 Write property tests for Learning_Agent — `tests/pbt/learning-agent.pbt.test.ts`
    - **Property 24: Evaluation version records always contain all required fields** — Validates: Requirement 11.3
    - **Property 25: Priority scores respect the winning/failed rule** — Validates: Requirements 11.4, 11.5
    - **Property 26: KB update and event emission are atomic** — Validates: Requirement 11.6

- [ ] 15. Checkpoint — Ensure all implementations in this agent compile and core tests pass
  - Run `vitest --run tests/pbt/platform-validation.pbt.test.ts tests/pbt/post-variant.pbt.test.ts tests/pbt/analytics.pbt.test.ts tests/pbt/learning-agent.pbt.test.ts`
  - Ensure all tests pass; resolve any compilation or assertion failures before continuing.

- [ ] 16. Integration tests and full PBT suite wiring
  - [ ] 16.1 Implement integration tests in `tests/integration/`
    - Firecrawl full scrape round-trip — verify KB populated with mission, products, brand voice — Requirements 1.1, 1.2
    - RAG query latency ≤ 3s at 10k chunks — seed index with 10k chunks, time `semanticSearch` — Requirement 2.4
    - RAG re-index within 60s after KB write — write entity, assert index updated within 60s — Requirement 14.4
    - OpenCarousel carousel → PNG export — full 5-step flow, assert ZIP returned — Requirements 8.2, 8.3
    - Zernio analytics polling on observation window expiry — mock timer advance, assert Zernio queried — Requirements 10.1, 10.2
    - OpenCurriculum roadmap generation end-to-end — assert `RoadmapEntry[]` with ≥ 1 hypothesis per week — Requirement 6.1
    - Publishing retry with platform API mock — mock platform API to fail 3 times then succeed; assert correct backoff intervals (1 min, 2 min, 4 min) — Requirement 9.5
    - `knowledge_updated` event acknowledgement within 60s — trigger Learning_Agent KB update; assert event acknowledged — Requirement 11.6
    - Traceability chain query latency ≤ 3s — assert response time for a complete chain — Requirement 13.2
    - _Requirements: 1.1, 1.2, 2.4, 6.1, 8.2, 8.3, 9.5, 10.1, 10.2, 11.6, 13.2, 14.4_

  - [ ] 16.2 Wire all PBT files and confirm 100-run minimum per property
    - Open each of the 12 PBT test files under `tests/pbt/` and ensure every `fc.assert` call uses `{ numRuns: 100 }`
    - Add `// Feature: content-creator-ai, Property N: <property_text>` tag to every test
    - Confirm all 29 properties are represented across the 12 files:
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
    - Run `vitest --run tests/pbt` and fix any failures
    - _Requirements: All (via Properties 1–29)_

- [ ] 17. Final checkpoint — all tests pass
  - Run full test suite `vitest --run`: unit tests, PBT suite (29 properties × 100 runs), integration tests (9 scenarios)
  - Verify every requirement (1–14) is covered by at least one passing test
  - Verify all 29 correctness properties have a corresponding passing PBT sub-task
  - Verify smoke tests pass:
    - Local LLM reachable at configured Ollama endpoint
    - OpenCarousel running at `localhost:3000`
    - Vector store initialised and queryable
    - KB storage directory writable
    - All 9 platform adapters initialise without error
    - Zernio credentials valid

---

## Notes
- Tasks marked `*` are property-based tests using `fast-check` (min 100 runs each).
- Stub KB/RAG/Event Bus with simple in-memory implementations to unblock development; swap for Agent 1's implementation when merged.
- The `Analytics_Agent` (task 13.3) accepts an `onLearningTrigger` callback. Wire the `Learning_Agent` (task 14.4) into this callback after both are implemented.
- Platform adapter files (task 12.1) may be stub implementations if platform API credentials are unavailable; the `publish` method should throw `NotImplementedError` so retry/failure paths remain testable.
- Every PBT sub-task must be tagged `// Feature: content-creator-ai, Property N: <text>` at the top of the test.
- OpenCarousel instance expected at `localhost:3000` during development.

## Dependency Graph (within this agent)
```
Task 11.1 → Task 11.2 (PBT)
Task 11.1 → Task 11.3
Task 11.3 → Task 11.4
Task 11.4 → Task 11.5 (PBT)
Tasks 11.1 + 11.3 + 11.4 → Tasks 12.1, 12.2
Task 12.2 → Task 12.3 (unit tests)
Tasks 12.1 + 12.2 → Task 13.1
Task 13.1 → Tasks 13.2, 13.3
Task 13.3 → Task 13.4 (PBT)
Task 14.1 + 14.2 → Task 14.3
Task 14.3 → Task 14.4
Task 14.4 → Task 14.5 (PBT)
Task 13.3 + 14.4 → wire onLearningTrigger callback
Tasks 11.5 + 13.4 + 14.5 → Checkpoint 15
Checkpoint 15 → Tasks 16.1, 16.2
Tasks 16.1 + 16.2 → Final Checkpoint 17
```
