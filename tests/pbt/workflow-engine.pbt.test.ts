// Feature: content-creator-ai, Property 27: HITL mode always has at least one enabled checkpoint
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  CheckpointManager,
  APPROVAL_CHECKPOINT_STAGES,
} from "@/lib/content-creator-ai/orchestration/checkpoints.js";
import type { ApprovalCheckpointStage } from "@/lib/content-creator-ai/types/enums.js";
import { EventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";

const stageArb = fc.constantFrom(...APPROVAL_CHECKPOINT_STAGES);

/**
 * The operations a user can perform on checkpoint configuration.
 * `bulkDisable` and `disableAll` are the Requirement 12.10 paths.
 */
type Op =
  | { kind: "enable"; stage: ApprovalCheckpointStage }
  | { kind: "disable"; stage: ApprovalCheckpointStage }
  | { kind: "bulkDisable"; stages: ApprovalCheckpointStage[] }
  | { kind: "disableAll" }
  | { kind: "setMode"; mode: "Full_Auto_Mode" | "Human_In_The_Loop_Mode" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("enable" as const), stage: stageArb }),
  fc.record({ kind: fc.constant("disable" as const), stage: stageArb }),
  fc.record({
    kind: fc.constant("bulkDisable" as const),
    stages: fc.array(stageArb, { minLength: 1, maxLength: 9 }),
  }),
  fc.record({ kind: fc.constant("disableAll" as const) }),
  fc.record({
    kind: fc.constant("setMode" as const),
    mode: fc.constantFrom("Full_Auto_Mode" as const, "Human_In_The_Loop_Mode" as const),
  }),
);

describe("Workflow engine / checkpoint property tests", () => {
  let bus: EventBus;
  let managers: CheckpointManager[];

  beforeEach(() => {
    bus = new EventBus();
    managers = [];
  });

  afterEach(() => {
    for (const m of managers) m.dispose();
  });

  function makeManager(
    enabledStages?: ApprovalCheckpointStage[],
  ): CheckpointManager {
    const m = new CheckpointManager({
      bus,
      enabledStages,
      autoTimers: false,
    });
    managers.push(m);
    return m;
  }

  // Feature: content-creator-ai, Property 27: HITL mode always has at least one enabled checkpoint
  test("Property 27: HITL mode never has zero enabled checkpoints", () => {
    fc.assert(
      fc.property(
        fc.array(stageArb, { minLength: 1, maxLength: 9 }),
        fc.array(opArb, { minLength: 1, maxLength: 30 }),
        (initialStages, ops) => {
          const manager = makeManager([...new Set(initialStages)]);

          // The invariant must hold before any operation...
          if (!manager.invariantHolds()) return false;

          for (const op of ops) {
            switch (op.kind) {
              case "enable":
                manager.enableCheckpoint(op.stage);
                break;
              case "disable":
                manager.disableCheckpoint(op.stage);
                break;
              case "bulkDisable":
                manager.bulkDisable(op.stages);
                break;
              case "disableAll":
                manager.disableAll();
                break;
              case "setMode":
                manager.setMode(op.mode);
                break;
            }

            // ...and after every single one.
            if (!manager.invariantHolds()) return false;
            if (
              manager.getMode() === "Human_In_The_Loop_Mode" &&
              manager.enabledCount() < 1
            ) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 27 / Req 12.9: disabling the last checkpoint one-at-a-time is refused", () => {
    fc.assert(
      fc.property(stageArb, (stage) => {
        const manager = makeManager([stage]);
        expect(manager.getMode()).toBe("Human_In_The_Loop_Mode");

        const result = manager.disableCheckpoint(stage);

        // Refused, count stays at 1, mode unchanged.
        return (
          result.ok === false &&
          typeof result.blockedMessage === "string" &&
          result.blockedMessage.length > 0 &&
          manager.enabledCount() === 1 &&
          manager.isEnabled(stage) &&
          manager.getMode() === "Human_In_The_Loop_Mode"
        );
      }),
      { numRuns: 100 },
    );
  });

  test("Req 12.10: a bulk disable of everything switches to Full_Auto_Mode", () => {
    fc.assert(
      fc.property(
        fc.array(stageArb, { minLength: 1, maxLength: 9 }),
        (initialStages) => {
          const manager = makeManager([...new Set(initialStages)]);
          const result = manager.disableAll();

          return (
            result.ok === true &&
            manager.getMode() === "Full_Auto_Mode" &&
            manager.invariantHolds() &&
            manager.notifications.some((n) => n.kind === "mode_auto_switched")
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Req 12.9: intermediate disables succeed while more than one remains", () => {
    const manager = makeManager([...APPROVAL_CHECKPOINT_STAGES]);
    expect(manager.enabledCount()).toBe(9);

    // Disable eight of nine, one at a time — all should succeed.
    for (let i = 0; i < 8; i++) {
      const result = manager.disableCheckpoint(APPROVAL_CHECKPOINT_STAGES[i]);
      expect(result.ok).toBe(true);
    }
    expect(manager.enabledCount()).toBe(1);

    // The ninth is refused.
    const last = manager.disableCheckpoint(APPROVAL_CHECKPOINT_STAGES[8]);
    expect(last.ok).toBe(false);
    expect(manager.enabledCount()).toBe(1);
  });

  test("Req 12.5: checkpoints can be enabled and disabled independently", () => {
    const manager = makeManager([...APPROVAL_CHECKPOINT_STAGES]);
    manager.disableCheckpoint("ContextReview");
    manager.disableCheckpoint("GoalReview");

    expect(manager.isEnabled("ContextReview")).toBe(false);
    expect(manager.isEnabled("GoalReview")).toBe(false);
    expect(manager.isEnabled("AudienceReview")).toBe(true);

    manager.enableCheckpoint("ContextReview");
    expect(manager.isEnabled("ContextReview")).toBe(true);
  });

  test("constructing HITL with nothing enabled falls back to Full_Auto_Mode", () => {
    const manager = makeManager([]);
    expect(manager.getMode()).toBe("Full_Auto_Mode");
    expect(manager.invariantHolds()).toBe(true);
  });

  test("switching into HITL with nothing enabled re-enables one checkpoint", () => {
    const manager = makeManager([]);
    expect(manager.getMode()).toBe("Full_Auto_Mode");

    const result = manager.setMode("Human_In_The_Loop_Mode");
    expect(result.mode).toBe("Human_In_The_Loop_Mode");
    expect(manager.enabledCount()).toBeGreaterThanOrEqual(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(manager.invariantHolds()).toBe(true);
  });
});
