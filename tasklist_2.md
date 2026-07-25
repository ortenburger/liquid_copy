# Task List — Part 2 of 3: Audience Agent, Content Agent, Publishing, Analytics Agent

## Assigned To: Cursor Agent 2

## Prerequisites (built by Agent 1 — must be complete before starting)
- All TypeScript interfaces exported from `src/lib/content-creator-ai/types/index.ts`
- `writeKBEntity`, `readKBEntity`, `getVersionChain` available in `src/lib/content-creator-ai/kb/storage.ts`
- `semanticSearch` and `indexDocuments` available in `src/lib/content-creator-ai/rag/vectorstore.ts`
- `Context_Agent` returning `ContextAgentOutput` including `companySummary`
- `Strategy_Agent` exposing `generateHypothesis`, `generateRoadmap`, `validateGoal`

## Scope
This agent builds the content production and distribution pipeline:
- Audience_Agent (persona research, overlap detection, merge, validation)
- Platform selection validators for all 9 social networks
- Content_Agent (OpenCarousel 5-step integration, brand context via RAG, variant validation)
- Publishing layer (9 platform adapters, queue, exponential-backoff retry)
- Analytics_Agent (Zernio polling, Welch's t-test significance, winner identification)

## Handoff Contract
When complete, the following must be available for Agent 3:
- `Audience_Agent` exposing `proposePersonas`, `acceptPersona`, `mergePersonas`, `createPersona`
- `Content_Agent` exposing `generateVariants(hypothesis, platforms): PostVariant[]`
- Publishing queue with `enqueue`, `retry`, `getFailedVariants` in `src/lib/content-creator-ai/publishing/queue.ts`
- `Analytics_Agent` exposing `ingestMetrics(experimentId)` and triggering `Learning_Agent` callback
- All PBT tests passing for this agent's scope: `vitest --run tests/pbt/persona.pbt.test.ts tests/pbt/platform-validation.pbt.test.ts tests/pbt/post-variant.pbt.test.ts tests/pbt/analytics.pbt.test.ts`

---

## Tasks

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
    - For each of the 9 platforms (Instagram, TikTok, LinkedIn, Facebook, Pinterest, Etsy, X, Threads, YouTube Shorts), validate: aspect ratio, caption length (in characters), hashtag count, CTA placement
    - Use the constraint table from the design document:

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

    - Flag violations with structured error output; allow advancement only if ≥ 1 platform passes all validators
    - Block all advancement if every selected platform fails validation; notify user
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 8.2 Write property test for platform content validation — `tests/pbt/platform-validation.pbt.test.ts`
    - **Property 14: Platform content validation flags all constraint violations** — Validates: Requirement 5.3

  - [ ] 8.3 Implement `Content_Agent` with OpenCarousel integration in `src/lib/content-creator-ai/agents/content-agent/index.ts`
    - Implement 5-step OpenCarousel flow:
      1. `POST /api/carousels` — create carousel with name derived from Hypothesis ID and platform aspect ratio
      2. `PUT /api/brand` + `POST /api/chat` — apply Hypothesis fields (Hook, Angle, Visual_Theme, Core_Copy, CTA) and brand context from RAG
      3. Slide generation — 1–10 slides per variant, stored as HTML body fragments
      4. `PUT /api/carousels/{id}` — set caption and hashtags
      5. `POST /api/carousels/{id}/export` — export as PNG ZIP
    - Map `SocialPlatform` to correct aspect ratio using platform constraint table
    - Retrieve brand voice, tone, visual theme history from RAG; include as context inputs to OpenCarousel
    - If RAG is unavailable: proceed with Hypothesis fields only; tag variant as `"generated_without_brand_context"`
    - Generate 2–5 `PostVariant` objects per platform per Hypothesis
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [ ] 8.4 Implement `PostVariant` validation and discard logic in `src/lib/content-creator-ai/agents/content-agent/variant-validation.ts`
    - Accept variant iff: ≥ 1 slide present AND every slide has non-empty image reference or non-empty text AND caption is non-empty; CTA absence is explicitly allowed
    - Discard invalid variants; preserve all valid variants; notify user of discarded count
    - Implement human-edit path: tag variant as `"human_edited"` in experiment record; cap `regenerationRetryCount` at 3
    - _Requirements: 8.4, 8.5, 8.8, 8.9_

  - [ ]* 8.5 Write property tests for post variant — `tests/pbt/post-variant.pbt.test.ts`
    - **Property 19: Post_Variant count per platform is always between 2 and 5** — Validates: Requirement 8.1
    - **Property 20: Post_Variant validation accepts exactly the correct structure** — Validates: Requirement 8.4
    - **Property 21: Human-edited variants are always tagged and retry count is bounded** — Validates: Requirement 8.9

- [ ] 9. Checkpoint — Ensure all agent implementations compile and core unit tests pass
  - Run `vitest --run tests/pbt/persona.pbt.test.ts tests/pbt/platform-validation.pbt.test.ts tests/pbt/post-variant.pbt.test.ts`
  - Ensure all tests pass; resolve any compilation or assertion failures before continuing.

- [ ] 10. Publishing layer
  - [ ] 10.1 Implement the 9 social platform publishing adapters in `src/lib/content-creator-ai/publishing/adapters/`
    - One adapter file per platform: `instagram.ts`, `tiktok.ts`, `linkedin.ts`, `facebook.ts`, `pinterest.ts`, `etsy.ts`, `x.ts`, `threads.ts`, `youtube-shorts.ts`
    - Each adapter implements a shared `PlatformAdapter` interface with `publish(variant: PostVariant): Promise<PublishRecord>`
    - _Requirements: 5.1, 9.1, 9.2_

  - [ ] 10.2 Implement publishing queue and retry logic in `src/lib/content-creator-ai/publishing/queue.ts`
    - Queue each approved `PostVariant` with a default schedule of next available slot within 24 hours unless user specifies otherwise
    - On API error: retry with exponential backoff — Attempt 1: immediate, Attempt 2: +1 min, Attempt 3: +2 min, Attempt 4: +4 min (final); mark as `failed` after 4 total attempts
    - On failure: set `retainUntil = now + 30 days`; notify user; allow manual retry/reschedule within retention window
    - Record `publishedAt`, `platform`, `postVariantId`, `hypothesisId` as linked experiment record on success
    - _Requirements: 9.1, 9.2, 9.5, 9.6_

  - [ ]* 10.3 Write unit tests for publishing retry schedule
    - Verify 1 min → 2 min → 4 min backoff intervals and `failed` state after 4 total attempts
    - Verify 30-day retention period set on failure (`retainUntil = now + 30 days`)
    - _Requirements: 9.5, 9.6_

- [ ] 11. Analytics_Agent
  - [ ] 11.1 Implement `ZernioAdapter` in `src/lib/content-creator-ai/integrations/zernio.ts`
    - Query Zernio after `observationWindowDays` (configurable 1–30, default 7) from publish timestamp
    - Detect partial data: if fewer than 5 of the 9 required metrics returned → log error, schedule retry after 1 hour, notify user after 3 failed retries
    - Return typed `ZernioMetrics` or structured error
    - _Requirements: 10.1, 10.5_

  - [ ] 11.2 Implement statistical significance computation in `src/lib/content-creator-ai/agents/analytics-agent/significance.ts`
    - Implement Welch's t-test on `engagementRate` across all variants; significance threshold: p < 0.05
    - Winner selection rules:
      - If one variant has statistically significantly higher `engagementRate` than all others → `determinationMethod: "statistically_significant"`
      - If p < 0.05 overall but no single dominant winner → highest absolute `engagementRate` wins → `determinationMethod: "highest_absolute"`
    - If significance not reached within observation window → record experiment as `inconclusive`
    - _Requirements: 10.3, 10.4, 10.7_

  - [ ] 11.3 Implement `Analytics_Agent` in `src/lib/content-creator-ai/agents/analytics-agent/index.ts`
    - Wire Zernio polling → associate each metric set with `PostVariant` ID and `Hypothesis` ID → compute significance → trigger `Learning_Agent` callback
    - Trigger `Learning_Agent` on completion regardless of conclusive or inconclusive outcome
    - Accept a `onLearningTrigger` callback in the constructor to avoid a circular dependency with Agent 3's `Learning_Agent`
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7_

  - [ ]* 11.4 Write property tests for analytics — `tests/pbt/analytics.pbt.test.ts`
    - **Property 22: Outcome classification always matches the defined thresholds** — Validates: Requirement 11.2
    - **Property 23: Winner identification always uses engagement rate as primary comparator** — Validates: Requirements 10.3, 10.4

---

## Notes
- Tasks marked `*` are property-based tests using `fast-check` (min 100 runs each). Do not skip unless building an MVP.
- The OpenCarousel instance is expected at `localhost:3000` during development (task 8.3).
- The `Analytics_Agent` (task 11.3) accepts a `onLearningTrigger` callback to avoid circular dependency — Agent 3 will wire the `Learning_Agent` into this callback.
- Platform adapter files (task 10.1) may be stub implementations initially if platform API credentials are unavailable; the `publish` method should throw a descriptive `NotImplemented` error so the retry/failure path can still be tested.
- Every PBT sub-task must be tagged `// Feature: content-creator-ai, Property N: <text>` at the top of the test.

## Dependency Graph (this agent's tasks)
```
[Prerequisites from Agent 1] → Tasks 7.1, 7.2, 8.1
Tasks 7.1 + 7.2 → Task 7.3 (PBT)
Tasks 7.1 + 7.2 → Task 7.4
Tasks 8.1 → Task 8.2 (PBT)
Tasks 7.4 + 8.1 → Task 8.3
Task 8.3 → Task 8.4
Task 8.4 → Task 8.5 (PBT)
Tasks 8.3 + 8.4 → Checkpoint 9
Checkpoint 9 → Tasks 10.1, 10.2, 11.1, 11.2
Task 10.2 → Task 10.3 (unit tests)
Tasks 11.1 + 11.2 → Task 11.3
Task 11.3 → Task 11.4 (PBT)
```
