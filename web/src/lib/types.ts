export type OperatingMode = "Full_Auto_Mode" | "Human_In_The_Loop_Mode";

export type WorkflowStage =
  | "ContextIngestion"
  | "GoalGeneration"
  | "AudienceResearch"
  | "PlatformSelection"
  | "RoadmapGeneration"
  | "HypothesisGeneration"
  | "ContentGeneration"
  | "PublishingQueue"
  | "AnalyticsIngestion"
  | "LearningUpdate";

export type StageStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "completed"
  | "failed";

export type ApprovalCheckpointStage =
  | "ContextReview"
  | "GoalReview"
  | "AudienceReview"
  | "RoadmapReview"
  | "HypothesisReview"
  | "ContentReview"
  | "PublishingApproval"
  | "ExperimentReview"
  | "NextIterationPlanning";

export type CheckpointStatus =
  | "idle"
  | "waiting"
  | "approved"
  | "edited"
  | "rejected"
  | "auto_escalated";

export type SocialPlatform =
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "facebook"
  | "pinterest"
  | "etsy"
  | "x"
  | "threads"
  | "youtube_shorts";

export const WORKFLOW_STAGES: WorkflowStage[] = [
  "ContextIngestion",
  "GoalGeneration",
  "AudienceResearch",
  "PlatformSelection",
  "RoadmapGeneration",
  "HypothesisGeneration",
  "ContentGeneration",
  "PublishingQueue",
  "AnalyticsIngestion",
  "LearningUpdate",
];

export const CHECKPOINT_STAGES: ApprovalCheckpointStage[] = [
  "ContextReview",
  "GoalReview",
  "AudienceReview",
  "RoadmapReview",
  "HypothesisReview",
  "ContentReview",
  "PublishingApproval",
  "ExperimentReview",
  "NextIterationPlanning",
];

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "tiktok",
  "linkedin",
  "facebook",
  "pinterest",
  "etsy",
  "x",
  "threads",
  "youtube_shorts",
];

export interface StageRecord {
  stage: WorkflowStage;
  status: StageStatus;
  approvedByUser: boolean;
  /** Optional stage output summary / payload from the live API. */
  summary?: string;
  studioPath?: string;
  error?: string;
}

export interface CheckpointRecord {
  stage: ApprovalCheckpointStage;
  enabled: boolean;
  status: CheckpointStatus;
  pendingOutput?: string;
}

export interface ExperimentCard {
  id: string;
  title: string;
  hook: string;
  platform: SocialPlatform;
  status: "draft" | "queued" | "published" | "measuring" | "won" | "failed";
  updatedAt: string;
}

export interface RAGPassage {
  content: string;
  sourceDoc: string;
  similarityScore: number;
  scope: string;
}

export interface WorkflowStatus {
  mode: OperatingMode;
  currentStage: WorkflowStage;
  stages: StageRecord[];
  checkpoints: CheckpointRecord[];
  platforms: SocialPlatform[];
}

/** Simple UI — Testing plan */
export interface RoadmapWeek {
  week: number;
  theme: string;
  objective: string;
}

export interface RoadmapSummary {
  title: string;
  weeks: RoadmapWeek[];
  summary: string;
}

export interface HypothesisCard {
  id: string;
  hook: string;
  angle?: string;
  platform: SocialPlatform;
  status: ExperimentCard["status"] | "active" | "draft_review";
  title?: string;
}

/** Simple UI — Overview history */
export interface PlanChangeRecord {
  id: string;
  stage: ApprovalCheckpointStage;
  action: CheckpointStatus;
  summary: string;
  at: string;
}

/** Simple UI — Insights (legacy shape; Analytics prefers AnalyticsRow) */
export interface InsightPiece {
  id: string;
  title: string;
  hook: string;
  platform: SocialPlatform;
  status: ExperimentCard["status"];
  note?: string;
}

/** Simple UI — Analytics */
export interface AnalyticsRow {
  id: string;
  title: string;
  hook: string;
  platform: SocialPlatform;
  status: ExperimentCard["status"];
  impressions: number;
  engagementRate: number;
  ctr: number;
  saves: number;
  shares: number;
  comments: number;
  winner?: boolean;
  note?: string;
}

export interface AnalyticsSummary {
  rows: AnalyticsRow[];
  winnerId?: string;
  inconclusive: boolean;
  summary: string;
  updatedAt: string;
}

/** Simple UI — Organization (general context) */
export interface OrgProfile {
  name: string;
  industry?: string;
  mission: string;
  brandVoice: string;
  values: string[];
  website?: string;
}

export interface OrgGoal {
  id: string;
  primaryObjective: string;
  targetPlatform: SocialPlatform;
  successMetrics: Array<{
    name: string;
    numericTarget: number;
    timePeriod: string;
    direction: "increase" | "decrease" | "maintain";
  }>;
  status: "proposed" | "accepted" | "modified" | "replaced";
}

export type KBEntityType =
  | "company_identity"
  | "product"
  | "audience"
  | "experiment";

export type RetrievalScope =
  | "company_memory"
  | "product_context"
  | "audience_learning"
  | "experiment_history";

export interface KBEntitySummary {
  entityId: string;
  entityType: KBEntityType;
  latestVersion: number;
  updatedAt?: string;
}

export interface KBDocumentView {
  entityId: string;
  found: boolean;
  markdown?: string;
  entityType?: KBEntityType;
  latestVersion?: number;
  updatedAt?: string;
}
