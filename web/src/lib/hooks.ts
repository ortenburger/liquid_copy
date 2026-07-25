import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { demoStore } from "./demo-store";
import { isDemoWorkspace, subscribeSettings } from "./settings";
import type { WorkflowStatus } from "./types";

function getSnapshot(): WorkflowStatus {
  return demoStore.status();
}

function getDemoFlag(): boolean {
  return isDemoWorkspace();
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

/** Live workflow status from the demo store (or one-shot fetch when using live API). */
export function useWorkflowStatus(): WorkflowStatus {
  const { simulation } = useDataMode();
  const demoStatus = useSyncExternalStore(
    demoStore.subscribe.bind(demoStore),
    getSnapshot,
    getSnapshot,
  );
  const [live, setLive] = useState<WorkflowStatus | null>(null);

  useEffect(() => {
    if (simulation) {
      setLive(null);
      return;
    }
    void api.getWorkflowStatus().then(setLive).catch(() => setLive(null));
  }, [simulation]);

  return !simulation && live ? live : demoStatus;
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
