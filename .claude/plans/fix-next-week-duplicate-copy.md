# Fix Next Week Duplicate Copy

## Goal
Next-week Plan generation must produce distinct hooks/angles by excluding prior queued weeks and reliably grounding on Insights MD.

## Root cause hypothesis

**Primary:** `generateSevenDayPlan` never receives prior queued weeks. Append only advances `weekStartDate`; the hyp prompt gets the same Insights + same RAG seed + "Prefer hooks/angles from the Performing playbook" with **zero anti-duplication**. LLM regenerates near-identical week copy.

**Amplifier:** `generateWeekPostingPlan` overwrites KB entity `testing-plan` (`company_identity`). Next gather pulls that doc into `KB markdown`, so week-1 hooks are re-fed as "context" when inventing week-2.

**Insights MD:** Plan path uses `loadInsightsPlanContext` (localStorage → KB), not RAG links. Linking is likely fine if Insights was run in-browser. RAG pin of `insights-latest` / `insights-performers` only matters when local cache empty and KB write succeeded — secondary, not the duplicate driver.

**Ruled out:** Week-id collision (would replace, not append a twin week); hyp-id carousel reuse (new `hyp-7d-${Date.now()}-*` each run).

## Steps
1. Collect prior-week exclusion list from `loadWeekQueue()` (hooks, titles, angles) in `analyzeInsightsAndPlanWeek` before generate — `web/src/lib/api.ts` — `frontend-dev`
2. Pass `priorWeekSlots` / exclusion text into `generateSevenDayPlan` options — `web/src/lib/api.ts` — `frontend-dev`
3. Add prompt rules: do not reuse/paraphrase listed hooks; invent new angles extending playbook winners; require distinct day-to-day tests — `web/src/lib/api.ts` (`generateSevenDayPlan`) — `frontend-dev`
4. Optional hardening: exclude or downrank `testing-plan` from `gatherRagMarkdownContext` during week planning (or pass `excludeEntityIds`) so central plan doesn't echo prior copy — `web/src/lib/api.ts` — `frontend-dev`
5. Ensure Insights still inject when local empty: if `loadInsightsPlanContext` is `none`, keep existing analyze+extract bootstrap; log/progress when source is `none` vs `local`/`kb` — already mostly done; verify only — `none`
6. Smoke: Plan → Next week → assert new week hooks ≠ prior week hooks (manual or light unit on exclusion-string builder) — `frontend-dev`

## Files Affected
- `web/src/lib/api.ts` — `analyzeInsightsAndPlanWeek`, `generateSevenDayPlan`, optionally `gatherRagMarkdownContext`
- `web/src/lib/posting-plan-store.ts` — maybe helper `formatPriorWeeksForPrompt(queue)` (optional extract)
- `web/src/pages/workspace/TestingPlan.tsx` — no change (already `mode: "append"`)

## Minimal fix approach
1. In `analyzeInsightsAndPlanWeek`, before `generateSevenDayPlan`, build exclusion block from `queueBefore.weeks` slots/hyps.
2. Thread into `generateSevenDayPlan` prompt as `Already planned (do not reuse): …`.
3. Exclude `CENTRAL_PLAN_ENTITY_ID` (`testing-plan`) from markdownSources when gathering for week planning.
4. Do not change Insights store schema or week-queue model.

## Security Considerations
- Client-only localStorage + existing KB writes; no new auth surface
- Prompt injection from prior hooks is user-owned content already in queue — treat as data, keep fenced/labeled block

## Unresolved Questions
- None blocking — user waived interview; fix is prompt + context plumbing
