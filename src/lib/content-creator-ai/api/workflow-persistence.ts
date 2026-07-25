/**
 * Persist WorkflowEngine stage progress to disk so Full Auto / HITL progress
 * survives API restarts until the operator hits Reset.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { OperatingMode, SocialPlatform } from "../types/enums.js";
import type { ApprovalCheckpointStage } from "../types/enums.js";
import { resolveKBStoragePath } from "../kb/storage.js";
import {
  type StageRecord,
  type WorkflowEngine,
  type WorkflowStage,
} from "../orchestration/workflow-engine.js";
import type { CheckpointState } from "../orchestration/checkpoints.js";

export interface WorkflowSnapshot {
  version: 1;
  savedAt: string;
  mode: OperatingMode;
  selectedPlatforms: SocialPlatform[];
  stages: StageRecord[];
  checkpoints: Array<{
    stage: ApprovalCheckpointStage;
    enabled: boolean;
    status: CheckpointState["status"];
  }>;
}

function snapshotPath(storagePath?: string): string {
  return join(resolveKBStoragePath(storagePath), "_workflow-state.json");
}

export function exportWorkflowSnapshot(
  workflow: WorkflowEngine,
): WorkflowSnapshot {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    mode: workflow.getMode(),
    selectedPlatforms: workflow.getSelectedPlatforms(),
    stages: workflow.listRecords(),
    checkpoints: workflow.checkpoints.listStates().map((s) => ({
      stage: s.stage,
      enabled: s.enabled,
      status: s.status === "waiting" ? "idle" : s.status,
    })),
  };
}

export function saveWorkflowSnapshot(
  workflow: WorkflowEngine,
  storagePath?: string,
): string {
  const path = snapshotPath(storagePath);
  const root = resolveKBStoragePath(storagePath);
  mkdirSync(root, { recursive: true });
  const snap = exportWorkflowSnapshot(workflow);
  writeFileSync(path, JSON.stringify(snap, null, 2), "utf8");
  return path;
}

export function loadWorkflowSnapshot(
  storagePath?: string,
): WorkflowSnapshot | null {
  const path = snapshotPath(storagePath);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as WorkflowSnapshot;
    if (raw?.version !== 1 || !Array.isArray(raw.stages)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function clearWorkflowSnapshot(storagePath?: string): void {
  const path = snapshotPath(storagePath);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}

/** Apply a saved snapshot onto a freshly constructed engine + checkpoints. */
export function hydrateWorkflowFromSnapshot(
  workflow: WorkflowEngine,
  snapshot: WorkflowSnapshot,
): void {
  workflow.restoreFromSnapshot(snapshot);
  console.info(
    `[workflow] restored snapshot from ${snapshot.savedAt} · current=${workflow.currentStage() ?? "complete"}`,
  );
}

export type { WorkflowStage };
