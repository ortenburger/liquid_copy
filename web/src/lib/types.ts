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
