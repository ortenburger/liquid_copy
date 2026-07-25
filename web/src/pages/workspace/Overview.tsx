import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import { api } from "../../lib/api";
import { useAsyncAction, useWorkflowStatus } from "../../lib/hooks";
import type { StageStatus } from "../../lib/types";
import "./workspace.css";

function toneFor(status: StageStatus) {
  if (status === "completed") return "active" as const;
  if (status === "in_progress" || status === "awaiting_approval")
    return "processing" as const;
  if (status === "failed") return "failed" as const;
  return "idle" as const;
}

function labelStatus(status: StageStatus) {
  return status.replace(/_/g, " ");
}

export function OverviewPage() {
  const status = useWorkflowStatus();
  const { busy, error, run } = useAsyncAction();
  const processing = status.stages.some(
    (s) => s.status === "in_progress" || s.status === "awaiting_approval",
  );

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operator workspace</p>
          <h1 className="page-title">Overview</h1>
        </div>
        <div className="mode-toggle" role="group" aria-label="Operating mode">
          <Button
            variant={
              status.mode === "Human_In_The_Loop_Mode" ? "primary" : "ghost"
            }
            disabled={busy}
            onClick={() => run(() => api.setMode("Human_In_The_Loop_Mode"))}
          >
            Human in the loop
          </Button>
          <Button
            variant={status.mode === "Full_Auto_Mode" ? "accent" : "ghost"}
            disabled={busy}
            onClick={() => run(() => api.setMode("Full_Auto_Mode"))}
          >
            Full auto
          </Button>
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <Progress active={processing} label="Agents advancing the experiment loop" />

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Workflow stages</h2>
          <span className="panel-meta">Current · {status.currentStage}</span>
        </div>
        <ol className="stage-rail">
          {status.stages.map((stage) => (
            <li
              key={stage.stage}
              className={`stage-item ${
                stage.stage === status.currentStage ? "is-current" : ""
              }`}
            >
              <div className="stage-top">
                <span className="stage-name">{stage.stage}</span>
                <Badge tone={toneFor(stage.status)}>
                  {labelStatus(stage.status)}
                </Badge>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
