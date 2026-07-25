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

export function WorkflowStagesPanel({
  status,
  title = "Workflow stages",
}: {
  status: WorkflowStatus;
  title?: string;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
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
            {stage.summary ? (
              <p className="stage-summary">{stage.summary}</p>
            ) : null}
            {stage.error && stage.status === "failed" ? (
              <p className="stage-summary">{stage.error}</p>
            ) : null}
            {stage.studioPath ? (
              <p className="stage-summary">
                <Link to={stage.studioPath}>Open in Carousels</Link>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
