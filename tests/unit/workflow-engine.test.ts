/**
 * Workflow engine unit tests (Task 8.4).
 * Feature: content-creator-ai
 * Requirements 12.6 (72h auto-escalation), 12.7 (rejection needs instructions or
 * a replacement), 12.8 (mode switch preserves prior approvals).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CheckpointManager,
  CHECKPOINT_TIMEOUT_MS,
} from "@/lib/content-creator-ai/orchestration/checkpoints.js";
import {
  WorkflowEngine,
  WORKFLOW_STAGES,
  STAGE_CHECKPOINT,
  type WorkflowStage,
} from "@/lib/content-creator-ai/orchestration/workflow-engine.js";
import { EventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";
import type { ApprovalCheckpointStage } from "@/lib/content-creator-ai/types/enums.js";

/** Handlers for every stage, returning a marker so outputs can be traced. */
function allStageHandlers(
  log: string[] = [],
): Partial<Record<WorkflowStage, () => unknown>> {
  const handlers: Partial<Record<WorkflowStage, () => unknown>> = {};
  for (const stage of WORKFLOW_STAGES) {
    handlers[stage] = () => {
      log.push(stage);
      return { producedBy: stage };
    };
  }
  return handlers;
}

describe("Workflow engine", () => {
  let bus: EventBus;
  let managers: CheckpointManager[];

  beforeEach(() => {
    bus = new EventBus();
    managers = [];
  });

  afterEach(() => {
    for (const m of managers) m.dispose();
    vi.useRealTimers();
  });

  function makeManager(
    options: Partial<ConstructorParameters<typeof CheckpointManager>[0]> = {},
  ): CheckpointManager {
    const m = new CheckpointManager({ bus, ...options });
    managers.push(m);
    return m;
  }

  // ---- Requirement 12.2: Full_Auto_Mode ----

  test("Full_Auto_Mode runs every stage without pausing", async () => {
    const log: string[] = [];
    const checkpoints = makeManager({ mode: "Full_Auto_Mode" });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(log),
    });

    const result = await engine.run();

    expect(result.status).toBe("completed");
    expect(log).toEqual([...WORKFLOW_STAGES]);
    expect(engine.isComplete()).toBe(true);
    // Nothing was explicitly approved, because nothing paused.
    expect(engine.listRecords().every((r) => r.approvedByUser === false)).toBe(true);
  });

  // ---- Requirement 12.3: HITL pauses ----

  test("HITL mode pauses at the first enabled checkpoint", async () => {
    const log: string[] = [];
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["ContextReview"],
      autoTimers: false,
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(log),
    });

    const result = await engine.run();

    expect(result.status).toBe("paused");
    expect(result.stage).toBe("ContextIngestion");
    expect(result.checkpoint).toBe("ContextReview");
    // Only the first stage ran.
    expect(log).toEqual(["ContextIngestion"]);
    expect(engine.getRecord("ContextIngestion").status).toBe("awaiting_approval");
  });

  test("approving a paused checkpoint resumes the workflow", async () => {
    const log: string[] = [];
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["ContextReview"],
      autoTimers: false,
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(log),
    });

    await engine.run();
    await checkpoints.approve("ContextReview");
    const result = await engine.resume();

    expect(result.status).toBe("completed");
    expect(log).toEqual([...WORKFLOW_STAGES]);
    expect(engine.getRecord("ContextIngestion").approvedByUser).toBe(true);
    expect(engine.getRecord("ContextIngestion").resolution).toBe("approved");
  });

  test("an inline edit at a checkpoint becomes the stage output", async () => {
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["ContextReview"],
      autoTimers: false,
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(),
    });

    await engine.run();
    await checkpoints.edit("ContextReview", { producedBy: "operator" });
    await engine.resume();

    expect(engine.getRecord("ContextIngestion").output).toEqual({
      producedBy: "operator",
    });
    expect(engine.getRecord("ContextIngestion").approvedByUser).toBe(true);
    expect(engine.getRecord("ContextIngestion").resolution).toBe("edited");
  });

  // ---- Requirement 12.6: 72-hour auto-escalation ----

  test("a checkpoint auto-escalates after 72 hours and notifies", async () => {
    vi.useFakeTimers();

    const timeouts: ApprovalCheckpointStage[] = [];
    bus.subscribe("checkpoint.timeout", (payload) => {
      timeouts.push(payload.stage);
    });

    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["GoalReview"],
    });

    await checkpoints.reach("GoalReview", { draft: "goal" });
    expect(checkpoints.getState("GoalReview").status).toBe("waiting");
    expect(timeouts).toEqual([]);

    // Just short of the deadline: nothing has happened yet.
    await vi.advanceTimersByTimeAsync(CHECKPOINT_TIMEOUT_MS - 1000);
    expect(checkpoints.getState("GoalReview").status).toBe("waiting");
    expect(timeouts).toEqual([]);

    // Crossing 72 hours escalates.
    await vi.advanceTimersByTimeAsync(2000);

    expect(timeouts).toEqual(["GoalReview"]);
    const state = checkpoints.getState("GoalReview");
    expect(state.status).toBe("auto_escalated");
    // Requirement 12.6 — pending output is preserved.
    expect(state.pendingOutput).toEqual({ draft: "goal" });
    expect(
      checkpoints.notifications.some(
        (n) => n.kind === "checkpoint_auto_escalated" && n.stage === "GoalReview",
      ),
    ).toBe(true);
  });

  test("auto-escalation is not recorded as explicit user approval", async () => {
    vi.useFakeTimers();
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["ContextReview"],
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(),
    });

    await engine.run();
    await vi.advanceTimersByTimeAsync(CHECKPOINT_TIMEOUT_MS + 1000);
    await engine.resume();

    const record = engine.getRecord("ContextIngestion");
    expect(record.status).toBe("completed");
    expect(record.resolution).toBe("auto_escalated");
    // Requirement 12.8 hinges on this distinction.
    expect(record.approvedByUser).toBe(false);
  });

  test("approving before the deadline cancels the escalation timer", async () => {
    vi.useFakeTimers();
    const timeouts: ApprovalCheckpointStage[] = [];
    bus.subscribe("checkpoint.timeout", (p) => {
      timeouts.push(p.stage);
    });

    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["GoalReview"],
    });

    await checkpoints.reach("GoalReview", { draft: "goal" });
    await checkpoints.approve("GoalReview");
    await vi.advanceTimersByTimeAsync(CHECKPOINT_TIMEOUT_MS * 2);

    expect(timeouts).toEqual([]);
    expect(checkpoints.getState("GoalReview").status).toBe("approved");
  });

  test("sweepTimeouts escalates every overdue checkpoint", async () => {
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["GoalReview", "AudienceReview"],
      autoTimers: false,
    });

    await checkpoints.reach("GoalReview", { a: 1 });
    await checkpoints.reach("AudienceReview", { b: 2 });

    // Nothing overdue yet.
    expect(await checkpoints.sweepTimeouts(Date.now())).toEqual([]);

    const later = Date.now() + CHECKPOINT_TIMEOUT_MS + 1000;
    const escalated = await checkpoints.sweepTimeouts(later);
    expect(escalated.sort()).toEqual(["AudienceReview", "GoalReview"]);
  });

  // ---- Requirement 12.7: rejection requires instructions or a replacement ----

  test("a bare rejection is blocked", async () => {
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["HypothesisReview"],
      autoTimers: false,
    });
    await checkpoints.reach("HypothesisReview", { draft: "h" });

    const result = await checkpoints.reject("HypothesisReview");

    expect(result.ok).toBe(false);
    expect(result.blockedMessage).toContain("free-text regeneration instructions");
    // Still waiting — the rejection was not accepted.
    expect(checkpoints.getState("HypothesisReview").status).toBe("waiting");
    expect(
      checkpoints.notifications.some((n) => n.kind === "rejection_blocked"),
    ).toBe(true);
  });

  test("a rejection with only whitespace instructions is blocked", async () => {
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["HypothesisReview"],
      autoTimers: false,
    });
    await checkpoints.reach("HypothesisReview", { draft: "h" });

    const result = await checkpoints.reject("HypothesisReview", {
      instructions: "   \n  ",
    });
    expect(result.ok).toBe(false);
    expect(checkpoints.getState("HypothesisReview").status).toBe("waiting");
  });

  test("a rejection with instructions is accepted", async () => {
    const rejections: Array<{ stage: string; instructions: string }> = [];
    bus.subscribe("checkpoint.rejected", (p) => {
      rejections.push(p);
    });

    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["HypothesisReview"],
      autoTimers: false,
    });
    await checkpoints.reach("HypothesisReview", { draft: "h" });

    const result = await checkpoints.reject("HypothesisReview", {
      instructions: "Lead with a customer result",
    });

    expect(result.ok).toBe(true);
    expect(checkpoints.getState("HypothesisReview").status).toBe("rejected");
    expect(rejections[0].instructions).toBe("Lead with a customer result");
  });

  test("a rejection with only a manual replacement is accepted", async () => {
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["HypothesisReview"],
      autoTimers: false,
    });
    await checkpoints.reach("HypothesisReview", { draft: "h" });

    const result = await checkpoints.reject("HypothesisReview", {
      replacement: { hook: "operator supplied" },
    });

    expect(result.ok).toBe(true);
    expect(checkpoints.getState("HypothesisReview").pendingOutput).toEqual({
      hook: "operator supplied",
    });
  });

  test("a rejection re-runs the stage with the operator's instructions", async () => {
    const seenInstructions: Array<string | undefined> = [];
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["ContextReview"],
      autoTimers: false,
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
    });
    for (const stage of WORKFLOW_STAGES) {
      engine.register(stage, (ctx) => {
        if (stage === "ContextIngestion") {
          seenInstructions.push(ctx.regenerationInstructions);
        }
        return { producedBy: stage };
      });
    }

    await engine.run();
    expect(seenInstructions).toEqual([undefined]);

    await checkpoints.reject("ContextReview", {
      instructions: "Use a warmer tone",
    });
    await engine.resume();

    // The stage was re-run, and the instructions were threaded through.
    expect(seenInstructions).toEqual([undefined, "Use a warmer tone"]);
  });

  // ---- Requirement 12.8: mode switch preserves prior approvals ----

  test("switching to Full_Auto_Mode preserves already-approved stages", async () => {
    const log: string[] = [];
    const checkpoints = makeManager({
      mode: "Human_In_The_Loop_Mode",
      enabledStages: ["ContextReview", "GoalReview", "AudienceReview"],
      autoTimers: false,
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(log),
    });

    // Approve the first two stages under HITL.
    await engine.run();
    await checkpoints.approve("ContextReview");
    await engine.resume();
    await checkpoints.approve("GoalReview");
    let result = await engine.resume();
    expect(result.status).toBe("paused");
    expect(result.stage).toBe("AudienceResearch");

    // Now switch mid-workflow.
    engine.setMode("Full_Auto_Mode");
    await checkpoints.approve("AudienceReview");
    result = await engine.resume();

    expect(result.status).toBe("completed");
    // Prior explicit approvals survived the switch.
    expect(engine.getRecord("ContextIngestion").approvedByUser).toBe(true);
    expect(engine.getRecord("GoalGeneration").approvedByUser).toBe(true);
    // Stages completed after the switch were never user-approved.
    expect(engine.getRecord("RoadmapGeneration").approvedByUser).toBe(false);
    expect(engine.getRecord("ContentGeneration").approvedByUser).toBe(false);
  });

  test("a mode switch only affects stages not yet complete", async () => {
    const checkpoints = makeManager({
      mode: "Full_Auto_Mode",
      enabledStages: ["ContentReview"],
      autoTimers: false,
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(),
    });

    // Run to completion in Full_Auto.
    await engine.run();
    expect(engine.isComplete()).toBe(true);
    const before = engine.listRecords();

    // Switching back to HITL must not reopen anything.
    engine.setMode("Human_In_The_Loop_Mode");
    const result = await engine.run();

    expect(result.status).toBe("completed");
    expect(engine.listRecords().map((r) => r.status)).toEqual(
      before.map((r) => r.status),
    );
  });

  test("switching into HITL pauses only the next incomplete stage", async () => {
    const checkpoints = makeManager({
      mode: "Full_Auto_Mode",
      // Gate the stage that will still be incomplete when the mode flips.
      // A checkpoint on an already-completed stage must NOT reopen it.
      enabledStages: ["ContentReview", "RoadmapReview"],
      autoTimers: false,
    });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
    });
    for (const stage of WORKFLOW_STAGES) {
      engine.register(stage, () => ({ producedBy: stage }));
    }

    // Stop the run early by leaving platforms unset for content generation.
    engine.setSelectedPlatforms([]);
    let result = await engine.run();
    expect(result.status).toBe("blocked");
    expect(result.stage).toBe("ContentGeneration");

    // RoadmapGeneration completed under Full_Auto, so it stays complete.
    expect(engine.getRecord("RoadmapGeneration").status).toBe("completed");

    engine.setMode("Human_In_The_Loop_Mode");
    engine.setSelectedPlatforms(["instagram"]);
    result = await engine.run();

    // Only the remaining ContentReview checkpoint pauses.
    expect(result.status).toBe("paused");
    expect(result.stage).toBe("ContentGeneration");
    expect(engine.getRecord("RoadmapGeneration").status).toBe("completed");
  });

  // ---- Requirement 5.4: platform guard ----

  test("content generation is blocked while no platform is selected", async () => {
    const checkpoints = makeManager({ mode: "Full_Auto_Mode" });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: [],
      handlers: allStageHandlers(),
    });

    const result = await engine.run();

    expect(result.status).toBe("blocked");
    expect(result.stage).toBe("ContentGeneration");
    expect(result.message).toContain("At least one publishing platform");
    // Earlier stages still completed.
    expect(engine.getRecord("PlatformSelection").status).toBe("completed");
  });

  test("selecting a platform unblocks content generation", async () => {
    const checkpoints = makeManager({ mode: "Full_Auto_Mode" });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: [],
      handlers: allStageHandlers(),
    });

    expect((await engine.run()).status).toBe("blocked");
    engine.setSelectedPlatforms(["linkedin", "linkedin", "instagram"]);
    // De-duplicated on the way in.
    expect(engine.getSelectedPlatforms()).toEqual(["linkedin", "instagram"]);

    expect((await engine.run()).status).toBe("completed");
  });

  // ---- Failure handling and observability ----

  test("a throwing stage handler is reported as failed", async () => {
    const checkpoints = makeManager({ mode: "Full_Auto_Mode" });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: {
        ContextIngestion: () => {
          throw new Error("scrape exploded");
        },
      },
    });

    const result = await engine.run();
    expect(result.status).toBe("failed");
    expect(result.stage).toBe("ContextIngestion");
    expect(result.message).toBe("scrape exploded");
    expect(engine.getRecord("ContextIngestion").error).toBe("scrape exploded");
  });

  test("subscribers see stage transitions in order", async () => {
    const checkpoints = makeManager({ mode: "Full_Auto_Mode" });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(),
    });

    const seen: string[] = [];
    engine.subscribe((event) => {
      if (event.type === "stage_started") seen.push(`start:${event.stage}`);
      if (event.type === "stage_completed") seen.push(`done:${event.stage}`);
    });

    await engine.run();

    expect(seen[0]).toBe("start:ContextIngestion");
    expect(seen[1]).toBe("done:ContextIngestion");
    expect(seen).toContain("done:LearningUpdate");
  });

  test("a throwing subscriber does not derail the workflow", async () => {
    const checkpoints = makeManager({ mode: "Full_Auto_Mode" });
    const engine = new WorkflowEngine({
      checkpoints,
      selectedPlatforms: ["instagram"],
      handlers: allStageHandlers(),
    });
    engine.subscribe(() => {
      throw new Error("bad listener");
    });

    const result = await engine.run();
    expect(result.status).toBe("completed");
  });

  test("PlatformSelection has no checkpoint, matching the nine stages", () => {
    expect(STAGE_CHECKPOINT.PlatformSelection).toBeNull();
    const mapped = WORKFLOW_STAGES.map((s) => STAGE_CHECKPOINT[s]).filter(Boolean);
    expect(mapped).toHaveLength(9);
    expect(new Set(mapped).size).toBe(9);
  });
});
