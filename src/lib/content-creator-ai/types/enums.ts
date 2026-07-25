/** Supported social publishing channels. */
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

/** Configurable HITL approval checkpoint stages. */
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

/** Platform operating mode. */
export type OperatingMode = "Full_Auto_Mode" | "Human_In_The_Loop_Mode";

/** Distinct RAG retrieval scopes over KB sections. */
export type RetrievalScope =
  | "product_context"
  | "company_memory"
  | "experiment_history"
  | "audience_learning";

/** Knowledge Base entity kinds used for versioning and events. */
export type KBEntityType =
  | "company_identity"
  | "product"
  | "audience"
  | "experiment";
