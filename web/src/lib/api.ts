import { demoStore } from "./demo-store";
import { getApiBaseUrl, isDemoWorkspace } from "./settings";
import type {
  ApprovalCheckpointStage,
  ExperimentCard,
  OperatingMode,
  RAGPassage,
  SocialPlatform,
  WorkflowStatus,
} from "./types";

function resolveLiveBase(): string | undefined {
  if (isDemoWorkspace()) return undefined;
  return getApiBaseUrl();
}

async function liveFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = resolveLiveBase();
  if (!baseUrl) {
    throw new Error(
      "Real data mode is on, but no API base URL is set. Add one in Settings.",
    );
  }
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

function useLive(): boolean {
  return Boolean(resolveLiveBase());
}

export const api = {
  isSimulation(): boolean {
    return isDemoWorkspace();
  },

  async getWorkflowStatus(): Promise<WorkflowStatus> {
    if (useLive()) return liveFetch("/api/content-creator-ai/workflow/status");
    return demoStore.status();
  },

  async setMode(mode: OperatingMode): Promise<WorkflowStatus> {
    if (useLive()) {
      const result = await liveFetch<{ status: WorkflowStatus }>(
        "/api/content-creator-ai/workflow/status",
        { method: "PUT", body: JSON.stringify({ mode }) },
      );
      return result.status;
    }
    return demoStore.setMode(mode);
  },

  async setPlatforms(platforms: SocialPlatform[]): Promise<SocialPlatform[]> {
    if (useLive()) {
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
    if (useLive()) {
      return liveFetch(
        `/api/content-creator-ai/checkpoints/${stage}/${action}`,
        { method: "POST", body: JSON.stringify(payload ?? {}) },
      );
    }
    if (action === "enable") return demoStore.setCheckpointEnabled(stage, true);
    if (action === "disable") return demoStore.setCheckpointEnabled(stage, false);
    if (action === "approve") return demoStore.approve(stage);
    if (action === "reject")
      return demoStore.reject(stage, payload?.instructions ?? "");
    return demoStore.edit(stage, payload?.notes ?? "");
  },

  async search(query: string): Promise<RAGPassage[]> {
    if (useLive()) {
      return liveFetch("/api/content-creator-ai/search", {
        method: "POST",
        body: JSON.stringify({ query, k: 10 }),
      });
    }
    await new Promise((r) => setTimeout(r, 350));
    return demoStore.search(query);
  },

  async listExperiments(): Promise<ExperimentCard[]> {
    // No dedicated list route yet — seed remains the UI feed
    return demoStore.listExperiments();
  },

  subscribe(listener: () => void): () => void {
    if (useLive()) return () => undefined;
    return demoStore.subscribe(listener);
  },
};
