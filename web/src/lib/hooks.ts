import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  api,
  clearLiveStatus,
  getEmptyLiveStatus,
  getLiveStatusError,
  getLiveStatusSnapshot,
  subscribeLiveStatus,
} from "./api";
import { demoStore } from "./demo-store";
import { isDemoWorkspace, subscribeSettings } from "./settings";
import type { WorkflowStatus } from "./types";

function getDemoSnapshot(): WorkflowStatus {
  return demoStore.status();
}

function getDemoFlag(): boolean {
  return isDemoWorkspace();
}

/** Real mode never falls back to demo fixtures. */
function getLiveSnapshot(): WorkflowStatus {
  return getLiveStatusSnapshot() ?? getEmptyLiveStatus();
}

function getLiveErrorSnapshot(): string | null {
  return getLiveStatusError();
}

/** Re-render when Settings data-mode toggles. */
export function useDataMode(): { simulation: boolean } {
  const simulation = useSyncExternalStore(
    subscribeSettings,
    getDemoFlag,
    getDemoFlag,
  );
  return { simulation };
}

/** Live workflow status from the demo store or the local API. */
export function useWorkflowStatus(): WorkflowStatus {
  const { simulation } = useDataMode();
  const demoStatus = useSyncExternalStore(
    demoStore.subscribe.bind(demoStore),
    getDemoSnapshot,
    getDemoSnapshot,
  );
  const liveStatus = useSyncExternalStore(
    subscribeLiveStatus,
    getLiveSnapshot,
    getLiveSnapshot,
  );

  useEffect(() => {
    if (simulation) {
      clearLiveStatus();
      return;
    }
    clearLiveStatus();
    void api.syncConfig().catch(() => undefined);
    void api.getWorkflowStatus().catch(() => undefined);
    const id = window.setInterval(() => {
      void api.getWorkflowStatus().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, [simulation]);

  return simulation ? demoStatus : liveStatus;
}

export function useLiveStatusError(): string | null {
  const { simulation } = useDataMode();
  const error = useSyncExternalStore(
    subscribeLiveStatus,
    getLiveErrorSnapshot,
    getLiveErrorSnapshot,
  );
  return simulation ? null : error;
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run, clearError: () => setError(null) };
}
