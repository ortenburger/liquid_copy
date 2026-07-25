# Simple UI Mode

## Goal
Add a Settings toggle that switches the workspace to a 5-tab Simple UI (Settings, Organization, Testing plan, Overview, Insights) with reduced nav, localStorage persistence, and graceful demo/real data behavior.

## Assumptions (reasonable defaults)
- **Overview path reuse**: Simple "Overview" mounts at `/app` (index), replacing the workflow stage rail when `simpleUi` is on. Full mode keeps current `OverviewPage`.
- **Toggle persistence**: `simpleUi` lives in `AppSettings` → same `liquid-copy.app-settings.v2` localStorage key; saves immediately on toggle (match `dataMode` UX).
- **Route guard**: Visiting full-only paths in Simple mode redirects to `/app`; visiting simple-only paths in Full mode redirects to `/app`.
- **Real mode gaps**: No experiments list API today (`api.listExperiments()` returns `[]` in real mode). v1 uses workflow checkpoints + KB search; no backend work unless follow-up requested.
- **AI Insights**: Client-side only via existing `completeWithSettings()`; RAG passage fallback if LLM fails/CORS.
- **Out of scope v1**: New backend endpoints, Carousels in Simple nav, per-user server sync of UI preference.

## Steps

1. Add `simpleUi: boolean` to `AppSettings` — default `false`; parse in `loadSettings()` — `web/src/lib/settings.ts` — `none`
2. Add `useSimpleUi()` hook (subscribeSettings + loadSettings) — `web/src/lib/hooks.ts` — `frontend-dev`
3. Add nav/route config module — `FULL_NAV`, `SIMPLE_NAV`, `FULL_ONLY_ROUTES`, `SIMPLE_ONLY_ROUTES`, `homePath()` — `web/src/lib/simple-ui-nav.ts` (new) — `frontend-dev`
4. Settings toggle — new "Interface" panel with Toggle "Simple UI" (saves immediately, redirects to `/app`) — `web/src/pages/workspace/Settings.tsx` — `frontend-dev`
5. Conditional nav + route guard in shell — swap `NAV`, add `useEffect` redirect when pathname blocked — `web/src/pages/workspace/Shell.tsx` — `frontend-dev`
6. Index route wrapper — `WorkspaceHome` renders `SimpleOverviewPage` vs `OverviewPage` by mode — `web/src/App.tsx` — `frontend-dev`
7. Register simple-only routes — `/app/testing-plan`, `/app/insights` — `web/src/App.tsx` — `frontend-dev`
8. Add shared types — `HypothesisCard`, `PlanChangeRecord`, `InsightPiece` — `web/src/lib/types.ts` — `frontend-dev`
9. Demo fixtures — `DEMO_ROADMAP`, `DEMO_HYPOTHESES` (or map from experiments) — `web/src/data/demo.ts` — `frontend-dev`
10. Demo store accessors — `getRoadmapSummary()`, `getHypotheses()`, `getPlanHistory()` — `web/src/lib/demo-store.ts` — `frontend-dev`
11. API helpers — `getTestingPlan()`, `getPlanHistory()`, `getTopContent()`, `generateInsightAnalysis()` — `web/src/lib/api.ts` — `frontend-dev`
12. Extract checkpoint row/actions — reusable `CheckpointRow` from Checkpoints page — `web/src/components/workspace/CheckpointRow.tsx` (new) — `frontend-dev`
13. Refactor Checkpoints to use `CheckpointRow` — `web/src/pages/workspace/Checkpoints.tsx` — `frontend-dev`
14. Build Testing plan page — roadmap panel + hypothesis list — `web/src/pages/workspace/TestingPlan.tsx` (new) — `frontend-dev`
15. Build Simple Overview page — pending approvals + history timeline — `web/src/pages/workspace/SimpleOverview.tsx` (new) — `frontend-dev`
16. Build Insights page — top content cards + brief analysis — `web/src/pages/workspace/Insights.tsx` (new) — `frontend-dev`
17. Styles — reuse `workspace.css` patterns; minimal page-specific CSS if needed — `web/src/pages/workspace/*.css` — `frontend-dev`

## Files Affected

| File | Change |
|------|--------|
| `web/src/lib/settings.ts` | Add `simpleUi` field + parse/default |
| `web/src/lib/hooks.ts` | Add `useSimpleUi()` |
| `web/src/lib/simple-ui-nav.ts` | **New** — nav + route guard constants |
| `web/src/lib/types.ts` | Add Simple UI view types |
| `web/src/lib/api.ts` | Add plan/history/insights data helpers |
| `web/src/lib/demo-store.ts` | Demo plan/history/hypothesis accessors |
| `web/src/data/demo.ts` | Demo roadmap + hypothesis fixtures |
| `web/src/components/workspace/CheckpointRow.tsx` | **New** — shared checkpoint UI |
| `web/src/pages/workspace/Shell.tsx` | Conditional nav + redirect guard |
| `web/src/pages/workspace/Settings.tsx` | Simple UI toggle panel |
| `web/src/pages/workspace/Checkpoints.tsx` | Use CheckpointRow |
| `web/src/pages/workspace/TestingPlan.tsx` | **New** |
| `web/src/pages/workspace/SimpleOverview.tsx` | **New** |
| `web/src/pages/workspace/Insights.tsx` | **New** |
| `web/src/App.tsx` | Route wrapper + new routes |

## Settings Persistence

```ts
// AppSettings addition
simpleUi: boolean; // default false

// loadSettings: simpleUi: parsed.simpleUi === true
// saveSettings: include simpleUi in cleaned blob (unchanged key SETTINGS_STORAGE_KEY)
```

Toggle in Settings saves immediately (like `dataMode`), calls `notifySettings()`, redirects to `/app`.

## Routing & Nav Switch

### Full mode (unchanged)
| Label | Path |
|-------|------|
| Overview | `/app` |
| Checkpoints | `/app/checkpoints` |
| Experiments | `/app/experiments` |
| Knowledge | `/app/knowledge` |
| Platforms | `/app/platforms` |
| Carousels | `/app/carousels` |
| Settings | `/app/settings` |

### Simple mode
| Label | Path |
|-------|------|
| Settings | `/app/settings` |
| Testing plan | `/app/testing-plan` |
| Overview | `/app` |
| Insights | `/app/insights` |

### Guard logic (in `Shell.tsx`)
```ts
if (simpleUi && FULL_ONLY_PREFIXES.some(p => pathname.startsWith(p)))
  navigate("/app", { replace: true });
if (!simpleUi && SIMPLE_ONLY_PREFIXES.some(p => pathname.startsWith(p)))
  navigate("/app", { replace: true });
```
Full-only: `/app/checkpoints`, `/app/experiments`, `/app/knowledge`, `/app/platforms`, `/app/carousels`
Simple-only: `/app/testing-plan`, `/app/insights`

## Page Content Spec

### 1. Settings (reuse)
- Existing page unchanged except new **Interface** panel at top:
  - Toggle: "Simple UI"
  - Description: "Reduce navigation to Settings, Testing plan, Overview, and Insights."
  - Badge showing current mode
- When Simple UI on, hide or soften Carousels cross-link in lead copy (optional polish).

### 2. Testing plan (`TestingPlan.tsx`)
**Purpose**: Readable plan + hypotheses without workflow jargon.

| Section | Source (simulation) | Source (real) |
|---------|---------------------|---------------|
| Roadmap summary | `demoStore` / `DEMO_ROADMAP` — 4-week theme slots | `checkpoints` where `stage === "RoadmapReview"`, parse `pendingOutput` (string or JSON) |
| Active hypothesis | `DEMO_HYPOTHESES[0]` or checkpoint `HypothesisReview` | Same checkpoint filter |
| Hypothesis list | Map `DEMO_EXPERIMENTS` → `HypothesisCard` (hook, platform, status) | Empty state + link to Settings if API idle; show checkpoint output if present |

**UI**: One roadmap `panel` (week/theme/objective bullets) + `card-grid` or `list-stack` of hypothesis cards (hook, angle if available, platform badge, status badge). No approve actions here — those live on Overview.

### 3. Overview (`SimpleOverview.tsx` at `/app`)
**Purpose**: Approvals queue + historical plan changes.

| Section | Implementation |
|---------|----------------|
| Pending approvals | Filter `status.checkpoints` where `status === "waiting"`; reuse `CheckpointRow` with approve/reject/edit/enable |
| Plan change history | Checkpoints with `approved` / `edited` / `rejected` + `pendingOutput` as last-known content; demo: `getPlanHistory()` returns 3–5 synthetic entries with stage label + timestamp |
| Empty state | "No pending approvals" + link to Testing plan |

**Reuse**: `useWorkflowStatus`, `useAsyncAction`, `api.checkpointAction` — same as `Checkpoints.tsx` but filtered to plan-relevant stages: `RoadmapReview`, `HypothesisReview`, `ContentReview`, `PublishingApproval`, `NextIterationPlanning`.

### 4. Insights (`Insights.tsx`)
**Purpose**: Best-performing content + minimal analysis.

| Section | Source |
|---------|--------|
| Top content | Demo: `DEMO_EXPERIMENTS` sorted — `won` > `published` > `measuring` > rest; take top 3–5 |
| Real | `api.search("winning hooks experiment outcomes")` → passages; optionally empty experiments state |
| Analysis | On mount or "Refresh analysis" button: `completeWithSettings(loadSettings().llm, prompt)` |

**LLM prompt** (minimal, robust):
```
Given these content pieces and KB snippets, write 2–3 short bullet insights
about what's working. No hype. Reference specific hooks. Max 120 words.
JSON not required — plain bullets only.

Content: ${JSON.stringify(topPieces.slice(0,5))}
KB: ${passages.slice(0,3).map(p => p.content).join("\n")}
```

**Fallback**: If LLM fails, show top RAG passage (`experiment_history` scope) as static insight. Use existing `Progress` + `StreamingCaret`; no purple gradients — standard `panel` + `info-banner`.

## Data Layer (`api.ts` additions)

```ts
getTestingPlan(): Promise<{ roadmap: string | RoadmapSummary; hypotheses: HypothesisCard[] }>
getPlanHistory(): Promise<PlanChangeRecord[]>
getTopContent(limit?: number): Promise<InsightPiece[]>
generateInsightAnalysis(pieces, passages): Promise<string>  // wraps completeWithSettings
```

- Simulation: delegate to `demoStore`
- Real: derive from `getWorkflowStatus()` checkpoints + `search()`; no new HTTP routes in v1

## Security Considerations
- `simpleUi` is client-only preference — no auth impact
- LLM keys already in localStorage; Insights uses same Settings LLM — no new secret surface
- Checkpoint approve/reject still goes through existing `api.checkpointAction` (same auth headers)
- No user HTML injection — render checkpoint `pendingOutput` as text/pre, not `dangerouslySetInnerHTML`

## Acceptance Criteria

1. Settings shows "Simple UI" toggle; persists across refresh via localStorage
2. Simple mode nav shows exactly 4 tabs in order: Settings, Testing plan, Overview, Insights
3. Full mode nav unchanged (7 tabs)
4. Toggling Simple UI on while on `/app/experiments` redirects to `/app`
5. Toggling Simple UI off while on `/app/insights` redirects to `/app`
6. `/app` renders `SimpleOverviewPage` when simple, `OverviewPage` when full
7. Testing plan shows roadmap + ≥1 hypothesis in simulation mode
8. Simple Overview shows pending approval with working Approve button (demo)
9. Insights shows ≥3 content pieces in simulation + analysis text or RAG fallback
10. Real mode: pages load without crash; empty states guide user to run workflow / enable API
11. Matches design system — `panel`, `Badge`, `Toggle`, Geist typography, no generic AI purple UI

## Test Plan

**Manual (simulation)**
- [ ] Enable Simple UI → nav has 4 items only
- [ ] Refresh → Simple UI still on
- [ ] Testing plan shows roadmap text + hypothesis cards
- [ ] Overview → approve RoadmapReview waiting checkpoint → status updates
- [ ] Insights → analysis appears or fallback passage shown
- [ ] Disable Simple UI → full nav restored; `/app` shows workflow stages

**Manual (real, API up)**
- [ ] Simple UI pages load with empty/partial data
- [ ] Checkpoint actions hit API
- [ ] Insights KB search returns passages when workflow has history

**Regression**
- [ ] Full mode Checkpoints page still works after CheckpointRow extraction
- [ ] Settings data mode toggle unaffected
- [ ] Carousels embed mode unaffected in full UI

## Unresolved Questions
- Should Simple UI default **on** for first-time users? (Plan: **off** — matches current power-user workspace)
- Should Insights auto-run LLM on page load or require explicit button? (Plan: **button** — avoids surprise API calls/cost)
- Future: add `GET /experiments` API for real-mode Insights? (Out of scope v1 — note for backend follow-up)
