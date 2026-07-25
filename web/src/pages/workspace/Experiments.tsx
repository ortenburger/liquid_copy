import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import type { ExperimentCard } from "../../lib/types";
import "./workspace.css";

function toneFor(status: ExperimentCard["status"]) {
  if (status === "won" || status === "published") return "active" as const;
  if (status === "queued" || status === "measuring" || status === "draft")
    return "processing" as const;
  return "failed" as const;
}

export function ExperimentsPage() {
  const { simulation } = useDataMode();
  const [items, setItems] = useState<ExperimentCard[]>([]);

  useEffect(() => {
    void api.listExperiments().then(setItems);
  }, [simulation]);

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Experiment feed</p>
          <h1 className="page-title">Experiments</h1>
        </div>
      </header>

      {!simulation && items.length === 0 ? (
        <p className="empty-hint">
          No live experiments yet — run the workflow, queue a carousel on{" "}
          <Link to="/app/test">Test</Link>, then Simulate / Publish to Zernio.
          Simulated publishes also appear on{" "}
          <Link to="/app/analytics">Analytics</Link>.
        </p>
      ) : null}

      <div className="card-grid">
        {items.map((exp) => (
          <Card key={exp.id}>
            <div className="card-header">
              <span className="card-title">{exp.title}</span>
              <span className="card-meta">
                {new Date(exp.updatedAt).toLocaleDateString()}
              </span>
            </div>
            <div className="card-media">{exp.platform}</div>
            <p className="card-hook">{exp.hook}</p>
            <Badge tone={toneFor(exp.status)}>{exp.status}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
