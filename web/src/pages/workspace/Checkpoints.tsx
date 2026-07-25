import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextArea } from "../../components/ui/Input";
import { api } from "../../lib/api";
import { useAsyncAction, useWorkflowStatus } from "../../lib/hooks";
import type { ApprovalCheckpointStage, CheckpointStatus } from "../../lib/types";
import "./workspace.css";

function toneFor(status: CheckpointStatus) {
  if (status === "approved" || status === "edited") return "active" as const;
  if (status === "waiting") return "processing" as const;
  if (status === "rejected" || status === "auto_escalated")
    return "failed" as const;
  return "idle" as const;
}

export function CheckpointsPage() {
  const status = useWorkflowStatus();
  const { busy, error, run } = useAsyncAction();
  const [instructions, setInstructions] = useState<
    Partial<Record<ApprovalCheckpointStage, string>>
  >({});

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
          <li key={cp.stage} className="list-row">
            <div className="list-row-main">
              <div className="list-row-title">
                <span>{cp.stage}</span>
                <Badge tone={toneFor(cp.status)}>{cp.status}</Badge>
                <Badge tone={cp.enabled ? "active" : "idle"}>
                  {cp.enabled ? "enabled" : "disabled"}
                </Badge>
              </div>
              {cp.pendingOutput ? (
                <p className="list-row-body">{cp.pendingOutput}</p>
              ) : null}
              {cp.status === "waiting" || cp.status === "rejected" ? (
                <TextArea
                  label="Regeneration instructions"
                  value={instructions[cp.stage] ?? ""}
                  onChange={(e) =>
                    setInstructions((prev) => ({
                      ...prev,
                      [cp.stage]: e.target.value,
                    }))
                  }
                  placeholder="Required when rejecting…"
                />
              ) : null}
            </div>
            <div className="list-row-actions">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api.checkpointAction(
                      cp.stage,
                      cp.enabled ? "disable" : "enable",
                    ),
                  )
                }
              >
                {cp.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                variant="primary"
                disabled={busy || cp.status !== "waiting"}
                onClick={() => run(() => api.checkpointAction(cp.stage, "approve"))}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                disabled={busy || cp.status !== "waiting"}
                onClick={() =>
                  run(() =>
                    api.checkpointAction(cp.stage, "edit", {
                      notes: instructions[cp.stage] ?? "Edited inline",
                    }),
                  )
                }
              >
                Edit
              </Button>
              <Button
                variant="accent"
                disabled={busy || (cp.status !== "waiting" && cp.status !== "rejected")}
                onClick={() =>
                  run(() =>
                    api.checkpointAction(cp.stage, "reject", {
                      instructions: instructions[cp.stage],
                    }),
                  )
                }
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
