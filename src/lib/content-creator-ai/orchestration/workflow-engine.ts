/**
 * Workflow Engine (Task 8.3) — Requirements 12.1, 12.2, 12.3, 12.8.
 *
 * Drives the ten workflow stages in order, pausing at enabled Approval
 * Checkpoints in HITL mode and running straight through in Full_Auto_Mode.
 *
 * Mode switching (Requirement 12.8): a switch is recorded on the engine and read
 * fresh on each stage transition, so it takes effect from the next incomplete
 * stage only. Stages already `completed` — and in particular their
 * `approvedByUser` flag — are never revisited, so prior explicit approvals
 * survive any number of mode changes.
 *
 * Progress is published to engine-local listeners rather than the Event Bus:
 * the bus's payload map is Agent 1's shared contract, and the SSE route bridges
 * both sources instead of widening it.
 */
import type { ApprovalCheckpointStage, OperatingMode, SocialPlatform } from "../types/enums.js";
import { CheckpointManager } from "./checkpoints.js";

/** Requirement 12.2 — the full workflow, in order. */
export const WORKFLOW_STAGES = [
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
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

/**
 * Which checkpoint gates each stage. `PlatformSelection` has none — the nine
 * checkpoint stages in Requirement 12.4 do not include it.
 */
export const STAGE_CHECKPOINT: Record<
  WorkflowStage,
  ApprovalCheckpointStage | null
> = {
  ContextIngestion: "ContextReview",
  GoalGeneration: "GoalReview",
  AudienceResearch: "AudienceReview",
  PlatformSelection: null,
  RoadmapGeneration: "RoadmapReview",
  HypothesisGeneration: "HypothesisReview",
  ContentGeneration: "ContentReview",
  PublishingQueue: "PublishingApproval",
  AnalyticsIngestion: "ExperimentReview",
  LearningUpdate: "NextIterationPlanning",
};

export type StageStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "completed"
  | "failed";

export interface StageRecord {
  stage: WorkflowStage;
  status: StageStatus;
  output?: unknown;
  /** True only for an explicit user approve/edit — not for auto-escalation. */
  approvedByUser: boolean;
  resolution?: "approved" | "edited" | "auto_escalated" | "auto" | "rejected";
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface StageContext {
  stage: WorkflowStage;
  mode: OperatingMode;
  /** Outputs of previously completed stages, keyed by stage name. */
  outputs: Readonly<Partial<Record<WorkflowStage, unknown>>>;
  /** Free-text instructions from a rejection, when the stage is being re-run. */
  regenerationInstructions?: string;
}

export type StageHandler = (context: StageContext) => Promise<unknown> | unknown;

export interface WorkflowEvent {
  type:
    | "stage_started"
    | "stage_completed"
    | "stage_awaiting_approval"
    | "stage_failed"
    | "stage_blocked"
    | "mode_changed"
    | "workflow_completed";
  stage?: WorkflowStage;
  mode?: OperatingMode;
  message?: string;
  at: string;
}

export type RunStatus =
  | "completed"
  | "paused"
  | "blocked"
  | "failed"
  | "idle";

export interface RunResult {
  status: RunStatus;
  /** The stage that paused, blocked or failed. */
  stage?: WorkflowStage;
  checkpoint?: ApprovalCheckpointStage;
  message?: string;
}

export interface WorkflowEngineOptions {
  checkpoints?: CheckpointManager;
  mode?: OperatingMode;
  /** Requirement 5.4 — content generation is blocked while this is empty. */
  selectedPlatforms?: SocialPlatform[];
  handlers?: Partial<Record<WorkflowStage, StageHandler>>;
}

export class WorkflowEngine {
  private readonly records = new Map<WorkflowStage, StageRecord>();
  private readonly handlers = new Map<WorkflowStage, StageHandler>();
  private readonly listeners = new Set<(event: WorkflowEvent) => void>();
  private selectedPlatforms: SocialPlatform[];
  private pendingInstructions?: string;
  readonly checkpoints: CheckpointManager;
  readonly events: WorkflowEvent[] = [];

  constructor(options: WorkflowEngineOptions = {}) {
    this.checkpoints =
      options.checkpoints ??
      new CheckpointManager({ mode: options.mode ?? "Human_In_The_Loop_Mode" });
    if (options.mode) this.checkpoints.setMode(options.mode);
    this.selectedPlatforms = [...(options.selectedPlatforms ?? [])];

    for (const stage of WORKFLOW_STAGES) {
      this.records.set(stage, {
        stage,
        status: "pending",
        approvedByUser: false,
      });
    }
    for (const [stage, handler] of Object.entries(options.handlers ?? {})) {
      if (handler) this.handlers.set(stage as WorkflowStage, handler);
    }
  }

  // ---- Configuration ----

  register(stage: WorkflowStage, handler: StageHandler): this {
    this.handlers.set(stage, handler);
    return this;
  }

  getMode(): OperatingMode {
    return this.checkpoints.getMode();
  }

  /**
   * Switch operating mode (Requirement 12.8). Only stages not yet completed are
   * affected; completed stages keep their outputs and approval flags.
   */
  setMode(mode: OperatingMode): { mode: OperatingMode; warnings: string[] } {
    const result = this.checkpoints.setMode(mode);
    this.emit({ type: "mode_changed", mode: result.mode });
    return result;
  }

  /** Requirement 5.2 — replace the active publishing targets. */
  setSelectedPlatforms(platforms: SocialPlatform[]): void {
    this.selectedPlatforms = [...new Set(platforms)];
  }

  getSelectedPlatforms(): SocialPlatform[] {
    return [...this.selectedPlatforms];
  }

  subscribe(listener: (event: WorkflowEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Inspection ----

  getRecord(stage: WorkflowStage): StageRecord {
    return { ...this.records.get(stage)! };
  }

  listRecords(): StageRecord[] {
    return WORKFLOW_STAGES.map((s) => this.getRecord(s));
  }

  outputs(): Partial<Record<WorkflowStage, unknown>> {
    const out: Partial<Record<WorkflowStage, unknown>> = {};
    for (const stage of WORKFLOW_STAGES) {
      const record = this.records.get(stage)!;
      if (record.status === "completed") out[stage] = record.output;
    }
    return out;
  }

  /** The first stage that is not yet completed, or null when all are done. */
  currentStage(): WorkflowStage | null {
    for (const stage of WORKFLOW_STAGES) {
      if (this.records.get(stage)!.status !== "completed") return stage;
    }
    return null;
  }

  isComplete(): boolean {
    return this.currentStage() === null;
  }

  // ---- Execution ----

  /**
   * Advance from the current stage as far as possible.
   *
   * In Full_Auto_Mode this runs to completion. In HITL it stops at the first
   * enabled checkpoint and returns `paused`; call `resume()` after the operator
   * resolves it.
   */
  async run(): Promise<RunResult> {
    for (;;) {
      const stage = this.currentStage();
      if (!stage) {
        this.emit({ type: "workflow_completed" });
        return { status: "completed" };
      }

      const record = this.records.get(stage)!;
      if (record.status === "awaiting_approval") {
        return {
          status: "paused",
          stage,
          checkpoint: STAGE_CHECKPOINT[stage] ?? undefined,
          message: `${stage} is awaiting approval.`,
        };
      }

      const guard = this.checkGuards(stage);
      if (guard) {
        record.status = "pending";
        this.emit({ type: "stage_blocked", stage, message: guard });
        return { status: "blocked", stage, message: guard };
      }

      const outcome = await this.executeStage(stage);
      if (outcome.status !== "completed") return outcome;
    }
  }

  /**
   * Resolve a paused stage from its checkpoint state and continue.
   *
   * A rejection re-runs the stage handler with the operator's regeneration
   * instructions; approve/edit/auto-escalate complete it.
   */
  async resume(): Promise<RunResult> {
    const stage = this.currentStage();
    if (!stage) return { status: "completed" };

    const record = this.records.get(stage)!;
    if (record.status !== "awaiting_approval") return this.run();

    const checkpointStage = STAGE_CHECKPOINT[stage];
    if (!checkpointStage) {
      record.status = "completed";
      record.resolution = "auto";
      record.completedAt = new Date().toISOString();
      return this.run();
    }

    const state = this.checkpoints.getState(checkpointStage);
    switch (state.status) {
      case "approved":
      case "edited":
        record.output = state.pendingOutput;
        record.approvedByUser = true;
        record.resolution = state.status;
        record.status = "completed";
        record.completedAt = new Date().toISOString();
        this.emit({ type: "stage_completed", stage });
        break;

      case "auto_escalated":
        record.output = state.pendingOutput;
        // Auto-escalation is not explicit approval (Requirement 12.8).
        record.approvedByUser = false;
        record.resolution = "auto_escalated";
        record.status = "completed";
        record.completedAt = new Date().toISOString();
        this.emit({
          type: "stage_completed",
          stage,
          message: `${stage} was auto-escalated after the 72-hour timeout.`,
        });
        break;

      case "rejected":
        // Re-run with the instructions the rejection required (Req 12.7).
        record.status = "pending";
        record.resolution = "rejected";
        this.pendingInstructions =
          state.rejectionInstructions ?? extractInstructions(state.pendingOutput);
        break;

      default:
        return {
          status: "paused",
          stage,
          checkpoint: checkpointStage,
          message: `${stage} is still awaiting approval.`,
        };
    }

    return this.run();
  }

  /** Run exactly one stage, honouring its checkpoint. */
  private async executeStage(stage: WorkflowStage): Promise<RunResult> {
    const record = this.records.get(stage)!;
    const handler = this.handlers.get(stage);

    record.status = "in_progress";
    record.startedAt = new Date().toISOString();
    record.error = undefined;
    this.emit({ type: "stage_started", stage });

    let output: unknown;
    if (handler) {
      try {
        output = await handler({
          stage,
          mode: this.getMode(),
          outputs: this.outputs(),
          regenerationInstructions: this.pendingInstructions,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record.status = "failed";
        record.error = message;
        this.emit({ type: "stage_failed", stage, message });
        return { status: "failed", stage, message };
      } finally {
        this.pendingInstructions = undefined;
      }
    }

    record.output = output;

    const checkpointStage = STAGE_CHECKPOINT[stage];
    if (checkpointStage) {
      // Mode is read here, not cached, so a switch applies from this stage on.
      const reached = await this.checkpoints.reach(checkpointStage, output);
      if (reached.paused) {
        record.status = "awaiting_approval";
        this.emit({ type: "stage_awaiting_approval", stage });
        return {
          status: "paused",
          stage,
          checkpoint: checkpointStage,
          message: `${stage} is awaiting approval.`,
        };
      }
    }

    record.status = "completed";
    record.resolution = "auto";
    record.completedAt = new Date().toISOString();
    this.emit({ type: "stage_completed", stage });
    return { status: "completed", stage };
  }

  /** Preconditions that block a stage regardless of mode. */
  private checkGuards(stage: WorkflowStage): string | null {
    if (stage === "ContentGeneration" && this.selectedPlatforms.length === 0) {
      // Requirement 5.4.
      return "At least one publishing platform must be selected before content generation can begin.";
    }
    return null;
  }

  private emit(event: Omit<WorkflowEvent, "at">): void {
    const full: WorkflowEvent = { ...event, at: new Date().toISOString() };
    this.events.push(full);
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        // A failing listener must not derail the workflow.
      }
    }
  }
}

/** Pull free-text instructions out of a rejected checkpoint's stored output. */
function extractInstructions(pendingOutput: unknown): string | undefined {
  if (typeof pendingOutput === "string") return pendingOutput;
  if (
    typeof pendingOutput === "object" &&
    pendingOutput !== null &&
    "instructions" in pendingOutput
  ) {
    const value = (pendingOutput as { instructions?: unknown }).instructions;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
