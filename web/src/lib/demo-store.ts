import {
  DEMO_ANALYTICS,
  DEMO_EXPERIMENTS,
  DEMO_HYPOTHESES,
  DEMO_KB_ENTITIES,
  DEMO_KB_MARKDOWN,
  DEMO_ORG_GOAL,
  DEMO_ORG_PROFILE,
  DEMO_PASSAGES,
  DEMO_PLAN_HISTORY,
  DEMO_ROADMAP,
} from "../data/demo";
import {
  CHECKPOINT_STAGES,
  WORKFLOW_STAGES,
  type AnalyticsSummary,
  type ApprovalCheckpointStage,
  type CheckpointRecord,
  type ExperimentCard,
  type HypothesisCard,
  type InsightPiece,
  type KBDocumentView,
  type KBEntitySummary,
  type OperatingMode,
  type OrgGoal,
  type OrgProfile,
  type PlanChangeRecord,
  type RAGPassage,
  type RetrievalScope,
  type RoadmapSummary,
  type SocialPlatform,
  type StageRecord,
  type WorkflowStatus,
} from "./types";

function initialStages(): StageRecord[] {
  return WORKFLOW_STAGES.map((stage, index) => {
    if (index < 4) {
      return { stage, status: "completed", approvedByUser: true };
    }
    if (index === 4) {
      return { stage, status: "awaiting_approval", approvedByUser: false };
    }
    if (index === 5) {
      return { stage, status: "in_progress", approvedByUser: false };
    }
    return { stage, status: "pending", approvedByUser: false };
  });
}

function initialCheckpoints(): CheckpointRecord[] {
  return CHECKPOINT_STAGES.map((stage) => {
    if (stage === "RoadmapReview") {
      return {
        stage,
        enabled: true,
        status: "waiting",
        pendingOutput: JSON.stringify(DEMO_ROADMAP, null, 2),
      };
    }
    if (stage === "HypothesisReview") {
      return {
        stage,
        enabled: true,
        status: "waiting",
        pendingOutput: JSON.stringify(DEMO_HYPOTHESES.slice(0, 2), null, 2),
      };
    }
    if (stage === "ContextReview" || stage === "GoalReview" || stage === "AudienceReview") {
      return { stage, enabled: true, status: "approved" };
    }
    return { stage, enabled: true, status: "idle" };
  });
}

class DemoStore {
  mode: OperatingMode = "Human_In_The_Loop_Mode";
  stages: StageRecord[] = initialStages();
  checkpoints: CheckpointRecord[] = initialCheckpoints();
  platforms: SocialPlatform[] = ["instagram", "linkedin", "tiktok"];
  experiments: ExperimentCard[] = [...DEMO_EXPERIMENTS];
  private listeners = new Set<() => void>();
  /** Cached for useSyncExternalStore — must be referentially stable until notify(). */
  private cachedStatus: WorkflowStatus | null = null;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.cachedStatus = null;
    for (const listener of this.listeners) listener();
  }

  status(): WorkflowStatus {
    if (this.cachedStatus) return this.cachedStatus;

    const current =
      this.stages.find(
        (s) =>
          s.status === "in_progress" ||
          s.status === "awaiting_approval",
      )?.stage ??
      this.stages.find((s) => s.status === "pending")?.stage ??
      WORKFLOW_STAGES[WORKFLOW_STAGES.length - 1];

    this.cachedStatus = {
      mode: this.mode,
      currentStage: current,
      stages: this.stages.map((s) => ({ ...s })),
      checkpoints: this.checkpoints.map((c) => ({ ...c })),
      platforms: [...this.platforms],
    };
    return this.cachedStatus;
  }

  setMode(mode: OperatingMode): WorkflowStatus {
    this.mode = mode;
    this.notify();
    return this.status();
  }

  setPlatforms(platforms: SocialPlatform[]): SocialPlatform[] {
    this.platforms = [...platforms];
    this.notify();
    return [...this.platforms];
  }

  setCheckpointEnabled(stage: ApprovalCheckpointStage, enabled: boolean): CheckpointRecord {
    const enabledCount = this.checkpoints.filter((c) => c.enabled).length;
    const target = this.checkpoints.find((c) => c.stage === stage);
    if (!target) throw new Error(`Unknown checkpoint ${stage}`);
    if (!enabled && target.enabled && enabledCount <= 1 && this.mode === "Human_In_The_Loop_Mode") {
      throw new Error("At least one checkpoint must remain enabled in HITL mode");
    }
    target.enabled = enabled;
    this.notify();
    return { ...target };
  }

  approve(stage: ApprovalCheckpointStage): CheckpointRecord {
    const target = this.checkpoints.find((c) => c.stage === stage);
    if (!target) throw new Error(`Unknown checkpoint ${stage}`);
    target.status = "approved";
    target.pendingOutput = undefined;
    const stageName = stage.replace(/Review$|Approval$|Planning$/, (m) => {
      if (m === "Approval") return "Queue";
      if (m === "Planning") return "";
      return "";
    });
    void stageName;
    // Advance matching workflow stage if awaiting
    const awaiting = this.stages.find((s) => s.status === "awaiting_approval");
    if (awaiting) {
      awaiting.status = "completed";
      awaiting.approvedByUser = true;
      const idx = this.stages.findIndex((s) => s.stage === awaiting.stage);
      const next = this.stages[idx + 1];
      if (next && next.status === "pending") {
        next.status = this.mode === "Full_Auto_Mode" ? "completed" : "in_progress";
        if (this.mode === "Full_Auto_Mode") next.approvedByUser = false;
      }
    }
    this.notify();
    return { ...target };
  }

  reject(stage: ApprovalCheckpointStage, instructions: string): CheckpointRecord {
    if (!instructions.trim()) {
      throw new Error("Rejection requires regeneration instructions");
    }
    const target = this.checkpoints.find((c) => c.stage === stage);
    if (!target) throw new Error(`Unknown checkpoint ${stage}`);
    target.status = "rejected";
    target.pendingOutput = instructions.trim();
    this.notify();
    return { ...target };
  }

  edit(stage: ApprovalCheckpointStage, notes: string): CheckpointRecord {
    const target = this.checkpoints.find((c) => c.stage === stage);
    if (!target) throw new Error(`Unknown checkpoint ${stage}`);
    target.status = "edited";
    target.pendingOutput = notes;
    this.notify();
    return { ...target };
  }

  search(query: string, limit = 10): RAGPassage[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return DEMO_PASSAGES.filter(
      (p) =>
        p.content.toLowerCase().includes(q) ||
        p.scope.toLowerCase().includes(q) ||
        p.sourceDoc.toLowerCase().includes(q),
    )
      .slice(0, Math.min(limit, 10))
      .sort((a, b) => b.similarityScore - a.similarityScore);
  }

  listExperiments(): ExperimentCard[] {
    return [...this.experiments];
  }

  getRoadmapSummary(): RoadmapSummary {
    return DEMO_ROADMAP;
  }

  getHypotheses(): HypothesisCard[] {
    return [...DEMO_HYPOTHESES];
  }

  getPlanHistory(): PlanChangeRecord[] {
    return [...DEMO_PLAN_HISTORY];
  }

  getTopContent(limit = 5): InsightPiece[] {
    const rank: Record<ExperimentCard["status"], number> = {
      won: 0,
      published: 1,
      measuring: 2,
      queued: 3,
      draft: 4,
      failed: 5,
    };
    return [...this.experiments]
      .sort((a, b) => rank[a.status] - rank[b.status])
      .slice(0, limit)
      .map((e) => ({
        id: e.id,
        title: e.title,
        hook: e.hook,
        platform: e.platform,
        status: e.status,
      }));
  }

  /** Reset roadmap + hypotheses to waiting review (Simple UI kickstart). */
  kickstartPlan(): WorkflowStatus {
    this.stages = initialStages();
    this.checkpoints = initialCheckpoints();
    this.notify();
    return this.status();
  }

  getOrgProfile(): OrgProfile {
    return { ...DEMO_ORG_PROFILE, values: [...DEMO_ORG_PROFILE.values] };
  }

  getOrgGoal(): OrgGoal {
    return {
      ...DEMO_ORG_GOAL,
      successMetrics: DEMO_ORG_GOAL.successMetrics.map((m) => ({ ...m })),
    };
  }

  listKBEntities(): KBEntitySummary[] {
    return DEMO_KB_ENTITIES.map((e) => ({ ...e }));
  }

  readKBEntity(entityId: string): KBDocumentView {
    const meta = DEMO_KB_ENTITIES.find((e) => e.entityId === entityId);
    const markdown = DEMO_KB_MARKDOWN[entityId];
    if (!markdown) return { entityId, found: false };
    return {
      entityId,
      found: true,
      markdown,
      entityType: meta?.entityType,
      latestVersion: meta?.latestVersion,
      updatedAt: meta?.updatedAt,
    };
  }

  getAnalytics(): AnalyticsSummary {
    return {
      ...DEMO_ANALYTICS,
      rows: DEMO_ANALYTICS.rows.map((r) => ({ ...r })),
    };
  }

  searchScoped(query: string, scope?: RetrievalScope, limit = 10): RAGPassage[] {
    const q = query.trim().toLowerCase();
    return DEMO_PASSAGES.filter((p) => {
      if (scope && p.scope !== scope) return false;
      if (!q) return true;
      return (
        p.content.toLowerCase().includes(q) ||
        p.scope.toLowerCase().includes(q) ||
        p.sourceDoc.toLowerCase().includes(q)
      );
    })
      .slice(0, Math.min(limit, 10))
      .sort((a, b) => b.similarityScore - a.similarityScore);
  }
}

export const demoStore = new DemoStore();
