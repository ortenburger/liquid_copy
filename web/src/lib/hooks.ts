import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { demoStore } from "../lib/demo-store";
import type { WorkflowStatus } from "../lib/types";

function getSnapshot(): WorkflowStatus {
  return demoStore.status();
}

/** Live workflow status from the demo store (or one-shot fetch when using live API). */
export function useWorkflowStatus(): WorkflowStatus {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const demoStatus = useSyncExternalStore(
    demoStore.subscribe.bind(demoStore),
    getSnapshot,
    getSnapshot,
  );
  const [live, setLive] = useState<WorkflowStatus | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    void api.getWorkflowStatus().then(setLive).catch(() => undefined);
  }, [baseUrl]);

  return baseUrl && live ? live : demoStatus;
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
