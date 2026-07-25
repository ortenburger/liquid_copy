import { Link } from "react-router-dom";
import { Badge } from "../ui/Badge";
import type { StageStatus, WorkflowStatus } from "../../lib/types";

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

function stageClass(status: StageStatus, isCurrent: boolean): string {
  const parts = ["stage-item"];
  if (isCurrent) parts.push("is-current");
  if (status === "in_progress") parts.push("is-working");
  if (status === "awaiting_approval") parts.push("is-awaiting");
  if (status === "completed") parts.push("is-done");
  if (status === "failed") parts.push("is-failed");
  return parts.join(" ");
}

export function WorkflowStagesPanel({
  status,
  title = "Workflow stages",
}: {
  status: WorkflowStatus;
  title?: string;
}) {
  const done = status.stages.filter((s) => s.status === "completed").length;
  const total = status.stages.length;

  return (
    <section className="panel workflow-panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <span className="panel-meta">
          {done}/{total} done · current {status.currentStage}
        </span>
      </div>
      <ol className="stage-rail" aria-label="Workflow steps">
        {status.stages.map((stage, index) => {
          const isCurrent = stage.stage === status.currentStage;
          return (
            <li
              key={stage.stage}
              className={stageClass(stage.status, isCurrent)}
            >
              <div className="stage-top">
                <span className="stage-index" aria-hidden>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="stage-name">{stage.stage}</span>
                <Badge tone={toneFor(stage.status)}>
                  {labelStatus(stage.status)}
                </Badge>
              </div>
              {stage.summary ? (
                <p className="stage-summary">{stage.summary}</p>
              ) : null}
              {stage.error && stage.status === "failed" ? (
                <p className="stage-summary stage-summary--error">
                  {stage.error}
                </p>
              ) : null}
              {stage.studioPath ? (
                <p className="stage-summary">
                  <Link to={stage.studioPath}>Open in Carousels</Link>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
