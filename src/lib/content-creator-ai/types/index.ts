/**
 * Shared contracts for content-creator-ai.
 * Single import point for Agents 2 and 3.
 */
export type {
  SocialPlatform,
  ApprovalCheckpointStage,
  OperatingMode,
  RetrievalScope,
  KBEntityType,
} from "./enums.js";

import type { SocialPlatform, RetrievalScope, KBEntityType } from "./enums.js";

// ---- Brand / Company ----

export interface BrandSignals {
  tone: string;
  style: string;
  recurringTerminology: string[];
}

export interface Product {
  id: string;
  name: string;
  features: string[];
  benefits: string[];
  pricing?: string;
  targetAudience?: string;
}

export interface CompanyIdentity {
  id: string;
  name: string;
  industry?: string;
  mission: string;
  vision?: string;
  brandVoice: string;
  values: string[];
  products: Product[];
  features: string[];
  benefits: string[];
  pricing?: string;
  brandSignals?: BrandSignals;
  businessObjectives?: string[];
  kbVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ---- KB Versioning ----

export interface KBVersion {
  versionId: string;
  entityId: string;
  entityType: KBEntityType | string;
  versionNumber: number;
  snapshotPath: string;
  priorValues: Record<string, unknown>;
  modifiedFields: string[];
  timestamp: string;
  author: "system" | "user";
}

export interface KBDocument {
  id: string;
  entityId: string;
  entityType: KBEntityType;
  scope: RetrievalScope;
  content: string;
  metadata?: Record<string, unknown>;
}

// ---- Goals & Metrics ----

export interface SuccessMetric {
  name: string;
  numericTarget: number;
  timePeriod: string;
  direction: "increase" | "decrease" | "maintain";
}

export interface MarketingGoal {
  id: string;
  primaryObjective: string;
  targetPlatform: SocialPlatform;
  successMetrics: SuccessMetric[];
  status: "proposed" | "accepted" | "modified" | "replaced";
  kbVersion: string;
  createdAt: string;
}

// ---- Audience ----

export interface AudiencePersona {
  id: string;
  icpDefinition: string;
  painPoints: string[];
  jobsToBeDone: string[];
  objections: string[];
  dreamOutcomes: string[];
  source: "ai_generated" | "user_created" | "merged";
  kbVersion: string;
  createdAt: string;
}

// ---- Hypothesis ----

export interface HypothesisVersion {
  versionId: string;
  fields: Partial<Omit<Hypothesis, "versions">>;
  timestamp: string;
}

export interface Hypothesis {
  id: string;
  hook: string;
  angle: string;
  coreCopy: string;
  painPoint: string;
  theme: string;
  visualTheme: string;
  successMetrics: SuccessMetric[];
  roadmapEntryId: string;
  goalId: string;
  status: "draft" | "approved" | "rejected" | "modified";
  kbStorageStatus: "persisted" | "failed";
  createdAt: string;
  versions: HypothesisVersion[];
}

// ---- Content ----

export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "2:3";

export interface PostSlide {
  id: string;
  html: string;
  order: number;
  hasImage: boolean;
  hasText: boolean;
}

export interface PostVariant {
  id: string;
  hypothesisId: string;
  platform: SocialPlatform;
  carouselId: string;
  slides: PostSlide[];
  caption: string;
  hashtags: string[];
  cta?: string;
  aspectRatio: AspectRatio;
  brandContextTag?: "generated_without_brand_context";
  humanEditTag?: "human_edited";
  regenerationRetryCount: number;
  validationStatus: "valid" | "invalid";
  status: "draft" | "queued" | "published" | "failed" | "retained";
  publishedAt?: string;
  retainUntil?: string;
  traceability: TraceabilityChain;
}

// ---- Analytics ----

export interface ZernioMetrics {
  impressions: number;
  ctr: number;
  saves: number;
  shares: number;
  comments: number;
  watchTime: number;
  conversions: number;
  engagementRate: number;
  followerGrowth: number;
}

export interface AnalyticsReport {
  postVariantId: string;
  hypothesisId: string;
  experimentId: string;
  observationWindowDays: number;
  metrics: ZernioMetrics;
  ingestStatus: "complete" | "partial" | "error";
  retryCount: number;
  ingestedAt: string;
}

export interface ExperimentSignificanceResult {
  experimentId: string;
  winningVariantId: string;
  determinationMethod: "statistically_significant" | "highest_absolute";
  confidenceLevel: number;
  conclusive: boolean;
  evaluatedAt: string;
}

// ---- Learning ----

export interface PostVariantOutcome {
  postVariantId: string;
  classification:
    | "exceeded_expectations"
    | "met_expectations"
    | "below_expectations"
    | "failed";
  observedValue: number;
  targetValue: number;
}

export interface ContentPattern {
  patternId: string;
  type: "hook" | "angle" | "visual_theme";
  value: string;
  priorityScore: number;
  experimentId: string;
  recencyWeight: number;
}

export interface HookPerformanceRecord {
  hook: string;
  experimentId: string;
  engagementRate: number;
  classification: PostVariantOutcome["classification"];
}

export interface ExperimentEvaluation {
  id: string;
  experimentId: string;
  evaluationTimestamp: string;
  postVariantOutcomes: PostVariantOutcome[];
  winningPatterns: ContentPattern[];
  failedPatterns: ContentPattern[];
  audienceLearnings: string[];
  hookPerformance: HookPerformanceRecord[];
}

export interface Experiment {
  id: string;
  hypothesisId: string;
  hypothesis?: Hypothesis;
  postVariantIds: string[];
  publishedDates: string[];
  analyticsResults?: AnalyticsReport[];
  statisticalSignificance?: ExperimentSignificanceResult;
  lessonsLearned?: string;
  winningPatterns?: ContentPattern[];
  failedPatterns?: ContentPattern[];
  status: "draft" | "running" | "completed" | "inconclusive";
  versionCounter: number;
  createdAt: string;
  updatedAt?: string;
}

// ---- Traceability ----

export interface TraceabilityLink {
  entityType: string;
  entityId: string;
  timestamp: string;
}

export interface TraceabilityChain {
  companyContextVersionId: string;
  marketingGoalId: string;
  audiencePersonaId: string;
  roadmapEntryId: string;
  hypothesisId: string;
  postVariantId: string;
  publishedRecordId?: string;
  analyticsReportId?: string;
  experimentEvaluationId?: string;
  status: "complete" | "partial" | "in_progress";
  links: TraceabilityLink[];
}

// ---- Publishing ----

export interface PublishRecord {
  id: string;
  postVariantId: string;
  hypothesisId: string;
  platform: SocialPlatform;
  scheduledAt: string;
  publishedAt?: string;
  status: "queued" | "published" | "failed" | "retrying";
  retryAttempts: number;
  retainUntil?: string;
}

// ---- Roadmap ----

export interface RoadmapEntry {
  id: string;
  weekNumber: number;
  theme: string;
  hypothesisSlot: string | null;
  businessObjectiveRef: string;
  successMetrics: SuccessMetric[];
  status: "pending" | "active" | "completed";
}

export interface ExperimentationRoadmap {
  id: string;
  goalId: string;
  durationWeeks: number;
  entries: RoadmapEntry[];
  kbStorageStatus: "confirmed" | "pending" | "failed";
  createdAt: string;
}

// ---- RAG ----

export interface RAGPassage {
  content: string;
  sourceDoc: string;
  similarityScore: number;
  scope: RetrievalScope;
}

// ---- Context Agent I/O ----

export interface ContextAgentInput {
  companyUrl?: string;
  freeTextEnrichment?: string;
  userEdits?: Partial<CompanyIdentity>;
}

export interface ContextAgentOutput {
  companySummary: CompanyIdentity;
  kbVersion: string;
  scrapedPageCount: number;
  durationMs: number;
  status: "success" | "partial" | "firecrawl_error" | "no_change";
  warnings?: string[];
}

/** Full KB document payload spanning all four top-level Markdown sections. */
export interface KBPayload {
  companyIdentity?: CompanyIdentity;
  products?: Product[];
  audiences?: AudiencePersona[];
  experiments?: Experiment[];
}
