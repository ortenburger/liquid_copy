# Plan page: hypotheses + posting plan + carousels

## Goal
After Generate plan, Plan page shows all hypotheses, a posting plan, and one carousel preview per hypothesis using existing `CarouselCardGrid` / open-carousel UI.

## Current state (verified)
- **Entry**: `TestingPlan.tsx` → `api.kickstartPlan()` / `generateTestingPlan`
  - Sim: `demoStore.kickstartPlan` resets `DEMO_ROADMAP` + `DEMO_HYPOTHESES`
  - Live: `runWorkflow()` (full pipeline; hyps appear as stages complete)
- **UI today**: Roadmap weeks + hypothesis text lists (upcoming / in-flight / settled). **No posting plan. No carousels.**
- **Hypothesis UI model**: thin `HypothesisCard` (`id`, `hook`, `angle?`, `platform`, `status`, `title?`) — `web/src/lib/types.ts`
- **Carousel UI**: `CarouselCardGrid` + `SlideRenderer` (used on Test page). Queue via `api.queueCarouselFromIdea` / `carousel-queue-store`. `OpenCarouselItem` has **no `hypothesisId`**.
- **Engine**: ContentGeneration (after HypothesisReview) already creates Open Carrusel decks — later in workflow, not at plan generation. Live HypothesisGeneration emits **one** hyp from active roadmap entry; demo has **four**.

## Clarified requirements (recommended defaults)
1. **All hypotheses** — Show full list (not only “upcoming”); keep status badges. Drop or demote in-flight/settled buckets if redundant.
2. **Posting plan** — Ordered schedule rows: week (from roadmap when mappable) · platform · hypothesis title/hook · scheduled slot (simple: week-based or +30m slots like engine `nextAvailableSlot`) · linked carousel card.
3. **One carousel per hypothesis** — On generate/regenerate (and when hyps exist without carousels), call existing `queueCarouselFromIdea` with idea = hook + angle; render via `CarouselCardGrid`. Sim → `buildDemoQueuedCarousel`; live → Open Carrusel.
4. **Link model** — Add optional `hypothesisId` (+ optional `scheduledAt`) on `OpenCarouselItem`; persist in queue store.
5. **Scope v1** — Simple UI Plan page + api/demo wiring. **Do not** change engine HypothesisGeneration multiplicity or ContentGeneration unless live returns &lt; needed hyps (then map whatever `getTestingPlan` returns).
6. **Out of scope v1** — Auto-publish; replacing Test page; full workflow ContentGeneration reuse as sole source.

## Challenges / risks
- **Duplicate carousels**: Plan-time queue vs later ContentGeneration can create two decks per hyp. v1: plan carousels are preview/queue for Simple UI; document; optional skip if `hypothesisId` already queued.
- **Live latency**: N hyps × LLM draft + Open Carrusel — generate sequentially with progress; don’t block entire page render.
- **Live hyp count**: Engine often yields 1 hyp; “all hypotheses” may be 1 until backend multi-hyp work (separate).
- **Roadmap ↔ hyp mapping**: `HypothesisCard` lacks `roadmapEntryId` / week. v1: assign week by index or extend card with optional `week?`.

## Assumptions (confirm with user)
- A1: Generate carousels **at plan time** (not wait for ContentGeneration approval).
- A2: Keep existing Roadmap panel; add **Posting plan** panel below hypotheses.
- A3: Posting plan = schedule list + carousel previews (not a full calendar widget).
- A4: Sim + live both supported; live needs Open Carrusel URL configured.

## Steps
1. Extend `OpenCarouselItem` with `hypothesisId?`, `scheduledAt?` — `web/src/lib/open-carousel.ts` — `frontend-dev`
2. Optional `week?` on `HypothesisCard` — `web/src/lib/types.ts` — `frontend-dev`
3. Demo: ensure each DEMO_HYPOTHESIS can map to a demo carousel; seed `hypothesisId` on DEMO queued items if needed — `web/src/data/demo.ts` — `frontend-dev`
4. Add `api.ensurePlanCarousels(hypotheses)` — for each hyp without queued carousel, `queueCarouselFromIdea`; build posting slots — `web/src/lib/api.ts` — `frontend-dev`
5. Hook generate path: after `kickstartPlan` / when `getTestingPlan` returns hyps, call `ensurePlanCarousels` — `web/src/lib/api.ts` + `TestingPlan.tsx` — `frontend-dev`
6. Expand `getTestingPlan` return (or parallel getters) with `postingPlan: { hypothesisId, week?, platform, scheduledAt, carousel }[]` — `web/src/lib/api.ts` — `frontend-dev`
7. Redesign Plan UI: (a) all hypotheses list (b) Posting plan panel with schedule rows + `CarouselCardGrid` filtered/ordered by plan — `web/src/pages/workspace/TestingPlan.tsx` — `frontend-dev-ui`
8. Reuse Test page open-studio / status patterns lightly (open editor on card click) — `TestingPlan.tsx` — `frontend-dev-ui`
9. Styles only if needed for schedule rows — `workspace.css` — `frontend-dev-ui`
10. Smoke: sim Generate plan → N hyp rows + N carousel cards in posting plan — `none`

## Files Affected
- `web/src/pages/workspace/TestingPlan.tsx` — main UI
- `web/src/lib/api.ts` — ensure carousels + posting plan payload
- `web/src/lib/open-carousel.ts` — `hypothesisId` / `scheduledAt`
- `web/src/lib/types.ts` — optional hyp week field; posting plan type
- `web/src/lib/carousel-queue-store.ts` — no API change (persists new fields)
- `web/src/data/demo.ts` — demo linkage
- `web/src/lib/demo-store.ts` — optional kickstart seeds carousels
- `web/src/components/open-carousel/CarouselCardGrid.tsx` — reuse as-is

## Security Considerations
- No new auth surface; client localStorage queue only.
- Live Open Carrusel calls use configured base URL (existing settings); no secrets in plan payload.
- Don’t persist LLM prompts with secrets; idea text = hyp hook/angle only.

## Unresolved Questions
1. Generate carousels **immediately on Generate plan**, or only after HypothesisReview approval?
2. Keep Roadmap weeks panel, replace it with Posting plan, or show both?
3. Live mode: OK if only **one** engine hypothesis appears until multi-hyp backend exists?
