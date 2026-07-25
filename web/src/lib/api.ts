import { demoStore } from "./demo-store";
import type {
  ApprovalCheckpointStage,
  ExperimentCard,
  OperatingMode,
  RAGPassage,
  SocialPlatform,
  WorkflowStatus,
} from "./types";

const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

async function liveFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async getWorkflowStatus(): Promise<WorkflowStatus> {
    if (baseUrl) return liveFetch("/api/content-creator-ai/workflow/status");
    return demoStore.status();
  },

  async setMode(mode: OperatingMode): Promise<WorkflowStatus> {
    if (baseUrl) {
      const result = await liveFetch<{ status: WorkflowStatus }>(
        "/api/content-creator-ai/workflow/status",
        { method: "PUT", body: JSON.stringify({ mode }) },
      );
      return result.status;
    }
    return demoStore.setMode(mode);
  },

  async setPlatforms(platforms: SocialPlatform[]): Promise<SocialPlatform[]> {
    if (baseUrl) {
      return liveFetch("/api/content-creator-ai/platform-selection", {
        method: "POST",
        body: JSON.stringify({ platforms }),
      });
    }
    return demoStore.setPlatforms(platforms);
  },

  async checkpointAction(
    stage: ApprovalCheckpointStage,
    action: "approve" | "reject" | "edit" | "enable" | "disable",
    payload?: { instructions?: string; notes?: string },
  ) {
    if (baseUrl) {
      return liveFetch(
        `/api/content-creator-ai/checkpoints/${stage}/${action}`,
        { method: "POST", body: JSON.stringify(payload ?? {}) },
      );
    }
    if (action === "enable") return demoStore.setCheckpointEnabled(stage, true);
    if (action === "disable") return demoStore.setCheckpointEnabled(stage, false);
    if (action === "approve") return demoStore.approve(stage);
    if (action === "reject") return demoStore.reject(stage, payload?.instructions ?? "");
    return demoStore.edit(stage, payload?.notes ?? "");
  },

  async search(query: string): Promise<RAGPassage[]> {
    if (baseUrl) {
      return liveFetch("/api/content-creator-ai/search", {
        method: "POST",
        body: JSON.stringify({ query, k: 10 }),
      });
    }
    // Simulate slight latency for liquid progress UX
    await new Promise((r) => setTimeout(r, 350));
    return demoStore.search(query);
  },

  async listExperiments(): Promise<ExperimentCard[]> {
    if (baseUrl) {
      // No dedicated list route yet — fall back to demo seed
      return demoStore.listExperiments();
    }
    return demoStore.listExperiments();
  },

  subscribe(listener: () => void): () => void {
    if (baseUrl) return () => undefined;
    return demoStore.subscribe(listener);
  },
};
