import { CheckpointRow } from "../../components/workspace/CheckpointRow";
import { api } from "../../lib/api";
import { useAsyncAction, useWorkflowStatus } from "../../lib/hooks";
import "./workspace.css";

export function CheckpointsPage() {
  const status = useWorkflowStatus();
  const { busy, error, run } = useAsyncAction();

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">HITL controls</p>
          <h1 className="page-title">Checkpoints</h1>
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <ul className="list-stack">
        {status.checkpoints.map((cp) => (
          <CheckpointRow
            key={cp.stage}
            checkpoint={cp}
            busy={busy}
            onAction={(stage, action, payload) =>
              run(() => api.checkpointAction(stage, action, payload))
            }
          />
        ))}
      </ul>
    </div>
  );
}
