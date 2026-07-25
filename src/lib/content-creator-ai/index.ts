/** Re-export shared foundation modules for Agents 2 and 3. */
export * from "./types/index.js";
export * from "./kb/storage.js";
export * from "./kb/markdown.js";
export * from "./kb/merge.js";
export * from "./rag/vectorstore.js";
export * from "./rag/reindex.js";
export * from "./orchestration/event-bus.js";

/**
 * Ingestion / strategy / audience / orchestration / API vertical.
 *
 * Exported by name rather than with `export *` because several modules
 * legitimately share constant names (for example `MIN_DURATION_WEEKS`, which
 * `roadmap.ts` re-exports from `opencurriculum.ts`), and a star re-export would
 * make those ambiguous at this barrel.
 */

// Integrations
export {
  FirecrawlAdapter,
  MAX_PAGES,
  MAX_DURATION_MS,
  type FirecrawlPage,
  type FirecrawlScrapeResult,
  type FirecrawlLimit,
  type FirecrawlAdapterOptions,
} from "./integrations/firecrawl.js";
export {
  OpenCurriculumAdapter,
  clampDurationWeeks,
  planLocally,
  MIN_DURATION_WEEKS,
  MAX_DURATION_WEEKS,
  type OpenCurriculumInput,
  type OpenCurriculumResult,
  type OpenCurriculumSuccess,
  type OpenCurriculumError,
} from "./integrations/opencurriculum.js";
export {
  OllamaLLMClient,
  OpenAICompatibleLLMClient,
  AnthropicLLMClient,
  FallbackLLMClient,
  UnavailableLLMClient,
  ScriptedLLMClient,
  buildLLMClientFromConfig,
  getLLMClient,
  setLLMClient,
  resetLLMClient,
  parseJSONFromLLM,
  resolveLLMBaseUrl,
  resolveLLMModel,
  type LLMClient,
  type LLMCompletionOptions,
  type BuildLLMClientConfig,
} from "./integrations/llm.js";

// Shared agent helpers
export {
  retrieveGrounding,
  formatPassages,
  NO_RETRIEVED_CONTEXT_TAG,
  MAX_GROUNDING_PASSAGES,
  type GroundingResult,
} from "./agents/shared/grounding.js";

// Context_Agent
export {
  ContextAgent,
  diffFields,
  type ContextAgentOptions,
  type ContextIngestResult,
  type ContextRecovery,
} from "./agents/context-agent/index.js";
export {
  QAPipeline,
  QA_STEPS,
  MAX_QA_PROMPTS,
  splitListAnswer,
  type QAFieldKey,
  type QAQuestion,
  type QASubmitResult,
} from "./agents/context-agent/qa-pipeline.js";
export {
  buildCompanySummary,
  deriveCompanyName,
  slugify,
  type BuildSummaryInput,
} from "./agents/context-agent/summary.js";

// Strategy_Agent
export {
  validateGoal,
  validateGeneratedGoal,
  assessCompanyContext,
  describeMissingFields,
  isMeasurableMetric,
  isSupportedPlatform,
  // `SUPPORTED_PLATFORMS` is deliberately NOT re-exported here: the publishing
  // layer below star-exports a constant of the same name and identical value, and
  // exporting both would make the name ambiguous at this barrel. The publishing
  // module is the more natural home for a platform list, so that one wins.
  // Import this vertical's copy from `agents/strategy-agent/goal-validation.js`
  // directly if the `readonly` variant is specifically wanted.
  type GoalValidationResult,
  type ContextSufficiency,
} from "./agents/strategy-agent/goal-validation.js";
export {
  generateMarketingGoal,
  confirmGoal,
  persistGoal,
  renderGoalMarkdown,
  DEFAULT_SUCCESS_METRIC,
  type GenerateGoalOptions,
  type GenerateGoalResult,
  type ConfirmGoalResult,
  type GoalStorageOutcome,
} from "./agents/strategy-agent/goals.js";
export {
  generateRoadmap,
  approveRoadmap,
  normaliseRoadmapEntries,
  validateRoadmap,
  readLessonsLearned,
  renderRoadmapMarkdown,
  type GenerateRoadmapOptions,
  type GenerateRoadmapResult,
  type ApproveRoadmapResult,
} from "./agents/strategy-agent/roadmap.js";
export {
  generateHypothesis,
  approveHypothesis,
  modifyHypothesis,
  rejectHypothesis,
  validateHypothesis,
  detectFailedPatternConflicts,
  proposeAlternative,
  readFailedPatterns,
  renderHypothesisMarkdown,
  MIN_PRIOR_OUTCOMES,
  REQUIRED_HYPOTHESIS_FIELDS,
  type GenerateHypothesisOptions,
  type GenerateHypothesisResult,
  type HypothesisConflict,
  type ApproveHypothesisResult,
  type RejectHypothesisResult,
} from "./agents/strategy-agent/hypothesis.js";

// Audience_Agent
export {
  validatePersona,
  describeMissingPersonaFields,
  type PersonaValidationResult,
} from "./agents/audience-agent/persona-validation.js";
export {
  jaccardSimilarity,
  shouldAlertOverlap,
  computePairwiseOverlap,
  findDuplicatePairs,
  isDistinctSet,
  alertOnDuplicates,
  mergePersonas,
  personaFieldValues,
  OVERLAP_THRESHOLD,
  PERSONA_CONTENT_FIELDS,
  type OverlapPair,
  type DuplicationAlert,
  type PersonaMergeResult,
} from "./agents/audience-agent/overlap.js";
export {
  AudienceAgent,
  MIN_PERSONAS,
  MAX_PERSONAS,
  RESEARCH_DEADLINE_MS,
  type ProposePersonasOptions,
  type ProposePersonasResult,
  type PersonaStoreResult,
} from "./agents/audience-agent/index.js";

// Orchestration
export {
  CheckpointManager,
  APPROVAL_CHECKPOINT_STAGES,
  CHECKPOINT_TIMEOUT_MS,
  type CheckpointState,
  type CheckpointStatus,
  type CheckpointManagerOptions,
  type Notification,
  type DisableResult,
  type ReachResult,
  type ResolveResult,
} from "./orchestration/checkpoints.js";
export {
  WorkflowEngine,
  WORKFLOW_STAGES,
  STAGE_CHECKPOINT,
  type WorkflowStage,
  type StageRecord,
  type StageStatus,
  type StageContext,
  type StageHandler,
  type WorkflowEvent,
  type RunResult,
  type RunStatus,
  type WorkflowEngineOptions,
} from "./orchestration/workflow-engine.js";

// Traceability + API runtime
export {
  TraceabilityBuilder,
  traceability,
  validateChain,
  newEntityId,
  newHypothesisId,
  newPostVariantId,
  newExperimentId,
  newExperimentEvaluationId,
  isGloballyUniqueId,
  TRACE_STAGES,
  type TraceStage,
  type HumanEditEvent,
  type TraceabilityQueryResult,
} from "./api/traceability.js";
export {
  getRuntime,
  setRuntime,
  resetRuntime,
  searchKnowledge,
  readKnowledgeBase,
  listKnowledgeBase,
  updateKnowledgeBase,
  updatePlatformSelection,
  workflowStatus,
  MAX_SEARCH_RESULTS,
  type Runtime,
  type SearchRequest,
  type SearchResponse,
  type PlatformSelectionResult,
  type WorkflowStatusResponse,
} from "./api/runtime.js";

/** Content / publishing / analytics / learning vertical. */
export * from "./publishing/platform-validators.js";
export * from "./publishing/queue.js";
export * from "./publishing/adapters/index.js";

export * from "./agents/content-agent/index.js";
export * from "./agents/content-agent/variant-validation.js";
export * from "./agents/analytics-agent/index.js";
export * from "./agents/analytics-agent/significance.js";
export * from "./agents/learning-agent/index.js";
export * from "./agents/learning-agent/classify.js";
export * from "./agents/learning-agent/patterns.js";
export * from "./agents/learning-agent/atomic-update.js";

export * from "./integrations/zernio.js";
