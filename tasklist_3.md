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

- [x] 11. Platform selection and Content_Agent
  - [x] 11.1 Implement platform constraint validators in `src/lib/content-creator-ai/publishing/platform-validators.ts`
  - [x]* 11.2 Write property test for platform content validation — `tests/pbt/platform-validation.pbt.test.ts`
  - [x] 11.3 Implement `Content_Agent` with OpenCarousel integration in `src/lib/content-creator-ai/agents/content-agent/index.ts`
  - [x] 11.4 Implement `PostVariant` validation and discard logic in `src/lib/content-creator-ai/agents/content-agent/variant-validation.ts`
  - [x]* 11.5 Write property tests for post variant — `tests/pbt/post-variant.pbt.test.ts`

- [x] 12. Publishing layer
  - [x] 12.1 Implement the 9 social platform publishing adapters in `src/lib/content-creator-ai/publishing/adapters/`
  - [x] 12.2 Implement publishing queue and retry logic in `src/lib/content-creator-ai/publishing/queue.ts`
  - [x]* 12.3 Write unit tests for publishing retry schedule

- [x] 13. Analytics_Agent
  - [x] 13.1 Implement `ZernioAdapter` in `src/lib/content-creator-ai/integrations/zernio.ts`
  - [x] 13.2 Implement statistical significance computation in `src/lib/content-creator-ai/agents/analytics-agent/significance.ts`
  - [x] 13.3 Implement `Analytics_Agent` in `src/lib/content-creator-ai/agents/analytics-agent/index.ts`
  - [x]* 13.4 Write property tests for analytics — `tests/pbt/analytics.pbt.test.ts`

- [x] 14. Learning_Agent
  - [x] 14.1 Implement outcome classification in `src/lib/content-creator-ai/agents/learning-agent/classify.ts`
  - [x] 14.2 Implement `ContentPattern` priority scoring in `src/lib/content-creator-ai/agents/learning-agent/patterns.ts`
  - [x] 14.3 Implement atomic KB update + event emission in `src/lib/content-creator-ai/agents/learning-agent/atomic-update.ts`
  - [x] 14.4 Implement `Learning_Agent` in `src/lib/content-creator-ai/agents/learning-agent/index.ts`
  - [x]* 14.5 Write property tests for Learning_Agent — `tests/pbt/learning-agent.pbt.test.ts`

- [x] 15. Checkpoint — Ensure all implementations in this agent compile and core tests pass

- [x] 16. Integration tests and full PBT suite wiring
  - [x] 16.1 Implement integration tests in `tests/integration/`
  - [x] 16.2 Wire all PBT files and confirm 100-run minimum per property
    - Agent 3 properties 14, 19–26: implemented with `{ numRuns: 100 }`
    - Agent 1 properties 1–7, 29: bumped to `{ numRuns: 100 }`
    - Agent 2 properties 8–13, 15–18, 27–28: still placeholders (skipped) pending Agent 2 merge

- [x] 17. Final checkpoint — all tests pass
  - Agent 3 unit/PBT/integration: passing
  - Full suite: 37 passed, 6 skipped (Agent 2 placeholders)
  - `tsc --noEmit`: clean

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
