/**
 * Approval_Checkpoint manager (Task 8.1) — Requirements 12.3–12.7, 12.9, 12.10.
 *
 * The invariant (Property 27) is precisely: **while the mode is
 * Human_In_The_Loop_Mode, at least one checkpoint is enabled.** Requirements
 * 12.9 and 12.10 pull in different directions and this is how they reconcile:
 *
 * - 12.9 — disabling the *last* enabled checkpoint one at a time is REJECTED;
 *   the count stays ≥ 1 and the mode is untouched.
 * - 12.10 — a bulk disable that would empty the set instead switches the mode to
 *   Full_Auto_Mode and notifies. The count may then be 0, but the mode is no
 *   longer HITL, so the invariant still holds.
 *
 * Timeouts use real `setTimeout`, so `vi.useFakeTimers()` can advance them, and
 * are unref'd so a pending 72-hour timer never holds a process open.
 */
import type { ApprovalCheckpointStage, OperatingMode } from "../types/enums.js";
import { eventBus, type EventBus } from "./event-bus.js";

/** Requirement 12.4 — the nine supported stages, in workflow order. */
export const APPROVAL_CHECKPOINT_STAGES: readonly ApprovalCheckpointStage[] = [
  "ContextReview",
  "GoalReview",
  "AudienceReview",
  "RoadmapReview",
  "HypothesisReview",
  "ContentReview",
  "PublishingApproval",
  "ExperimentReview",
  "NextIterationPlanning",
] as const;

/** Requirement 12.6. */
export const CHECKPOINT_TIMEOUT_MS = 72 * 60 * 60 * 1000;

export type CheckpointStatus =
  | "idle"
  | "waiting"
  | "approved"
  | "edited"
  | "rejected"
  | "auto_escalated";

export interface CheckpointState {
  stage: ApprovalCheckpointStage;
  enabled: boolean;
  status: CheckpointStatus;
  /** Preserved across resolution and auto-escalation (Requirement 12.6). */
  pendingOutput?: unknown;
  /** Free-text regeneration instructions supplied with a rejection (Req 12.7). */
  rejectionInstructions?: string;
  reachedAt?: string;
  resolvedAt?: string;
}

export interface Notification {
  kind:
    | "checkpoint_reached"
    | "checkpoint_auto_escalated"
    | "checkpoint_disable_blocked"
    | "mode_auto_switched"
    | "rejection_blocked";
  message: string;
  stage?: ApprovalCheckpointStage;
  at: string;
}

export interface CheckpointManagerOptions {
  mode?: OperatingMode;
  /** Enabled stages. Defaults to all nine. */
  enabledStages?: ApprovalCheckpointStage[];
  timeoutMs?: number;
  bus?: EventBus;
  /** Receives every notification as it is raised. */
  onNotify?: (notification: Notification) => void;
  /** Set false to manage timeouts manually via `sweepTimeouts`. */
  autoTimers?: boolean;
}

export interface DisableResult {
  ok: boolean;
  /** Set when the operation was refused (Requirement 12.9). */
  blockedMessage?: string;
  mode: OperatingMode;
  enabledCount: number;
}

export interface ReachResult {
  /** False when the stage is disabled or the mode is Full_Auto — no pause. */
  paused: boolean;
  state: CheckpointState;
}

export interface ResolveResult {
  ok: boolean;
  /** Set when a rejection lacked instructions and a replacement (Req 12.7). */
  blockedMessage?: string;
  state: CheckpointState;
}

export class CheckpointManager {
  private mode: OperatingMode;
  private readonly states = new Map<ApprovalCheckpointStage, CheckpointState>();
  private readonly timers = new Map<
    ApprovalCheckpointStage,
    ReturnType<typeof setTimeout>
  >();
  private readonly timeoutMs: number;
  private readonly bus: EventBus;
  private readonly onNotify?: (n: Notification) => void;
  private readonly autoTimers: boolean;
  readonly notifications: Notification[] = [];

  constructor(options: CheckpointManagerOptions = {}) {
    this.mode = options.mode ?? "Human_In_The_Loop_Mode";
    this.timeoutMs = options.timeoutMs ?? CHECKPOINT_TIMEOUT_MS;
    this.bus = options.bus ?? eventBus;
    this.onNotify = options.onNotify;
    this.autoTimers = options.autoTimers !== false;

    const enabled = new Set(options.enabledStages ?? APPROVAL_CHECKPOINT_STAGES);
    for (const stage of APPROVAL_CHECKPOINT_STAGES) {
      this.states.set(stage, {
        stage,
        enabled: enabled.has(stage),
        status: "idle",
      });
    }

    // A HITL manager constructed with nothing enabled cannot stay in HITL.
    if (this.mode === "Human_In_The_Loop_Mode" && this.enabledCount() === 0) {
      this.mode = "Full_Auto_Mode";
      this.notify({
        kind: "mode_auto_switched",
        message:
          "No approval checkpoints were enabled, so the operating mode was switched to Full_Auto_Mode.",
      });
    }
  }

  getMode(): OperatingMode {
    return this.mode;
  }

  /** Restore enabled flags (and idle status) from a persistence snapshot. */
  restoreCheckpointFlags(
    checkpoints: Array<{ stage: string; enabled: boolean; status?: string }>,
  ): void {
    for (const saved of checkpoints) {
      const state = this.states.get(saved.stage as ApprovalCheckpointStage);
      if (!state) continue;
      state.enabled = Boolean(saved.enabled);
      // Don't resume mid-wait timers across process restarts — back to idle.
      if (state.status === "waiting") {
        state.status = "idle";
        state.pendingOutput = undefined;
        state.reachedAt = undefined;
      }
    }
    if (this.mode === "Human_In_The_Loop_Mode" && this.enabledCount() === 0) {
      this.mode = "Full_Auto_Mode";
    }
  }

  getState(stage: ApprovalCheckpointStage): CheckpointState {
    const state = this.states.get(stage);
    if (!state) throw new Error(`Unknown checkpoint stage: ${stage}`);
    return { ...state };
  }

  listStates(): CheckpointState[] {
    return APPROVAL_CHECKPOINT_STAGES.map((s) => this.getState(s));
  }

  isEnabled(stage: ApprovalCheckpointStage): boolean {
    return this.states.get(stage)?.enabled === true;
  }

  enabledCount(): number {
    let count = 0;
    for (const state of this.states.values()) if (state.enabled) count += 1;
    return count;
  }

  enabledStages(): ApprovalCheckpointStage[] {
    return APPROVAL_CHECKPOINT_STAGES.filter((s) => this.isEnabled(s));
  }

  /**
   * The invariant Property 27 asserts. Exposed so callers (and the property
   * test) can check it after any operation sequence.
   */
  invariantHolds(): boolean {
    return this.mode !== "Human_In_The_Loop_Mode" || this.enabledCount() >= 1;
  }

  // ---- Configuration (Requirements 12.5, 12.9, 12.10) ----

  enableCheckpoint(stage: ApprovalCheckpointStage): DisableResult {
    const state = this.states.get(stage);
    if (!state) throw new Error(`Unknown checkpoint stage: ${stage}`);
    state.enabled = true;
    return { ok: true, mode: this.mode, enabledCount: this.enabledCount() };
  }

  /**
   * Disable one checkpoint. Refused when it is the last enabled one in HITL
   * mode (Requirement 12.9) — the mode is NOT switched for a single disable.
   */
  disableCheckpoint(stage: ApprovalCheckpointStage): DisableResult {
    const state = this.states.get(stage);
    if (!state) throw new Error(`Unknown checkpoint stage: ${stage}`);

    if (!state.enabled) {
      return { ok: true, mode: this.mode, enabledCount: this.enabledCount() };
    }

    if (this.mode === "Human_In_The_Loop_Mode" && this.enabledCount() <= 1) {
      const message =
        "At least one approval checkpoint must remain active in Human_In_The_Loop_Mode. " +
        `${stage} was not disabled.`;
      this.notify({ kind: "checkpoint_disable_blocked", message, stage });
      return {
        ok: false,
        blockedMessage: message,
        mode: this.mode,
        enabledCount: this.enabledCount(),
      };
    }

    state.enabled = false;
    return { ok: true, mode: this.mode, enabledCount: this.enabledCount() };
  }

  /**
   * Disable several checkpoints at once. When this would leave none enabled in
   * HITL mode, the mode switches to Full_Auto_Mode and the user is notified
   * (Requirement 12.10) instead of the operation being refused.
   */
  bulkDisable(stages: ApprovalCheckpointStage[]): DisableResult {
    for (const stage of stages) {
      const state = this.states.get(stage);
      if (state) state.enabled = false;
    }

    if (this.mode === "Human_In_The_Loop_Mode" && this.enabledCount() === 0) {
      this.mode = "Full_Auto_Mode";
      this.notify({
        kind: "mode_auto_switched",
        message:
          "All approval checkpoints were disabled, so the operating mode has been changed to Full_Auto_Mode.",
      });
    }

    return { ok: true, mode: this.mode, enabledCount: this.enabledCount() };
  }

  /** Disable every checkpoint — always routes through the 12.10 path. */
  disableAll(): DisableResult {
    return this.bulkDisable([...APPROVAL_CHECKPOINT_STAGES]);
  }

  /**
   * Switch operating mode (Requirement 12.8). Entering HITL with no checkpoints
   * enabled re-enables the first stage, since HITL with zero pauses is meaningless.
   */
  setMode(mode: OperatingMode): { mode: OperatingMode; warnings: string[] } {
    const warnings: string[] = [];
    if (mode === "Human_In_The_Loop_Mode" && this.enabledCount() === 0) {
      const first = APPROVAL_CHECKPOINT_STAGES[0];
      this.states.get(first)!.enabled = true;
      warnings.push(
        `Human_In_The_Loop_Mode requires at least one checkpoint; ${first} was re-enabled.`,
      );
    }
    this.mode = mode;
    return { mode: this.mode, warnings };
  }

  // ---- Runtime (Requirements 12.3, 12.6, 12.7) ----

  /**
   * Called when the workflow reaches a stage. Pauses only in HITL mode with the
   * stage enabled; otherwise reports `paused: false` and the workflow proceeds.
   */
  async reach(
    stage: ApprovalCheckpointStage,
    pendingOutput: unknown,
  ): Promise<ReachResult> {
    const state = this.states.get(stage);
    if (!state) throw new Error(`Unknown checkpoint stage: ${stage}`);

    if (this.mode === "Full_Auto_Mode" || !state.enabled) {
      return { paused: false, state: { ...state } };
    }

    state.status = "waiting";
    state.pendingOutput = pendingOutput;
    state.reachedAt = new Date().toISOString();
    state.resolvedAt = undefined;

    this.notify({
      kind: "checkpoint_reached",
      message: `${stage} is waiting for your review.`,
      stage,
    });
    await this.bus.publish("checkpoint.reached", { stage, pendingOutput });

    if (this.autoTimers) this.scheduleTimeout(stage);
    return { paused: true, state: { ...state } };
  }

  private scheduleTimeout(stage: ApprovalCheckpointStage): void {
    this.clearTimer(stage);
    const timer = setTimeout(() => {
      void this.autoEscalate(stage);
    }, this.timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.timers.set(stage, timer);
  }

  private clearTimer(stage: ApprovalCheckpointStage): void {
    const timer = this.timers.get(stage);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(stage);
    }
  }

  /**
   * Auto-escalate a waiting checkpoint (Requirement 12.6). Pending output is
   * preserved so nothing is lost when the operator returns.
   */
  async autoEscalate(stage: ApprovalCheckpointStage): Promise<CheckpointState> {
    const state = this.states.get(stage);
    if (!state) throw new Error(`Unknown checkpoint stage: ${stage}`);
    if (state.status !== "waiting") return { ...state };

    state.status = "auto_escalated";
    state.resolvedAt = new Date().toISOString();
    this.clearTimer(stage);

    this.notify({
      kind: "checkpoint_auto_escalated",
      message: `${stage} was auto-escalated because no action was taken within 72 hours.`,
      stage,
    });
    await this.bus.publish("checkpoint.timeout", { stage });
    return { ...state };
  }

  /**
   * Escalate every checkpoint whose 72-hour window has elapsed. For callers that
   * drive time explicitly rather than relying on timers.
   */
  async sweepTimeouts(now: number = Date.now()): Promise<ApprovalCheckpointStage[]> {
    const escalated: ApprovalCheckpointStage[] = [];
    for (const state of this.states.values()) {
      if (state.status !== "waiting" || !state.reachedAt) continue;
      if (now - Date.parse(state.reachedAt) >= this.timeoutMs) {
        await this.autoEscalate(state.stage);
        escalated.push(state.stage);
      }
    }
    return escalated;
  }

  async approve(stage: ApprovalCheckpointStage): Promise<ResolveResult> {
    const state = this.requireWaiting(stage);
    state.status = "approved";
    state.resolvedAt = new Date().toISOString();
    this.clearTimer(stage);
    await this.bus.publish("checkpoint.approved", { stage });
    return { ok: true, state: { ...state } };
  }

  /** Inline field modification, then approval (Requirement 12.6). */
  async edit(
    stage: ApprovalCheckpointStage,
    editedOutput: unknown,
  ): Promise<ResolveResult> {
    const state = this.requireWaiting(stage);
    state.status = "edited";
    state.pendingOutput = editedOutput;
    state.resolvedAt = new Date().toISOString();
    this.clearTimer(stage);
    await this.bus.publish("checkpoint.approved", { stage });
    return { ok: true, state: { ...state } };
  }

  /**
   * Reject a pending output. Requirement 12.7: blocked unless the operator
   * supplies free-text regeneration instructions OR a manual replacement.
   */
  async reject(
    stage: ApprovalCheckpointStage,
    options: { instructions?: string; replacement?: unknown } = {},
  ): Promise<ResolveResult> {
    const state = this.requireWaiting(stage);

    const hasInstructions =
      typeof options.instructions === "string" &&
      options.instructions.trim().length > 0;
    const hasReplacement =
      options.replacement !== undefined && options.replacement !== null;

    if (!hasInstructions && !hasReplacement) {
      const message =
        "A rejection needs either free-text regeneration instructions or a manual replacement before it can be accepted.";
      this.notify({ kind: "rejection_blocked", message, stage });
      return { ok: false, blockedMessage: message, state: { ...state } };
    }

    state.status = "rejected";
    state.resolvedAt = new Date().toISOString();
    if (hasReplacement) state.pendingOutput = options.replacement;
    // Retained on the state so the workflow engine can feed them into the
    // regeneration run, not just into the event payload.
    state.rejectionInstructions = hasInstructions
      ? options.instructions!.trim()
      : undefined;
    this.clearTimer(stage);

    await this.bus.publish("checkpoint.rejected", {
      stage,
      instructions: state.rejectionInstructions ?? "manual replacement supplied",
    });
    return { ok: true, state: { ...state } };
  }

  /** Cancel all pending timers. Call when tearing a workflow down. */
  dispose(): void {
    for (const stage of [...this.timers.keys()]) this.clearTimer(stage);
  }

  private requireWaiting(stage: ApprovalCheckpointStage): CheckpointState {
    const state = this.states.get(stage);
    if (!state) throw new Error(`Unknown checkpoint stage: ${stage}`);
    if (state.status !== "waiting") {
      throw new Error(
        `Checkpoint ${stage} is not awaiting review (status: ${state.status})`,
      );
    }
    return state;
  }

  private notify(notification: Omit<Notification, "at">): void {
    const full: Notification = { ...notification, at: new Date().toISOString() };
    this.notifications.push(full);
    this.onNotify?.(full);
  }
}
