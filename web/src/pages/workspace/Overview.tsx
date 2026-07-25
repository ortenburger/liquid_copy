import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import { WorkflowStagesPanel } from "../../components/workspace/WorkflowStagesPanel";
import { api } from "../../lib/api";
import {
  useAsyncAction,
  useDataMode,
  useLiveStatusError,
  useWorkflowStatus,
} from "../../lib/hooks";
import { loadSettings } from "../../lib/settings";
import "./workspace.css";

export function OverviewPage() {
  const status = useWorkflowStatus();
  const liveError = useLiveStatusError();
  const { busy, error, run } = useAsyncAction();
  const { simulation } = useDataMode();
  const processing = status.stages.some(
    (s) => s.status === "in_progress" || s.status === "awaiting_approval",
  );
  const llm = loadSettings().llm;
  const allPending =
    !simulation && status.stages.every((s) => s.status === "pending");
  const contentStage = status.stages.find((s) => s.stage === "ContentGeneration");
  const studioPath =
    contentStage?.studioPath ??
    (typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem("liquid-copy.last-studio-path")
      : null);

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operator workspace</p>
          <h1 className="page-title">Overview</h1>
        </div>
        <div className="mode-toggle" role="group" aria-label="Operating mode">
          {!simulation ? (
            <>
              <Button
                variant="accent"
                disabled={busy}
                onClick={() => run(() => api.runWorkflow())}
              >
                Run workflow
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => api.resetWorkflow())}
              >
                Reset
              </Button>
            </>
          ) : null}
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

      {simulation ? (
        <p className="info-banner">
          <Badge tone="processing">Simulation</Badge>{" "}
          Workflow fixtures are running in-browser. Flip{" "}
          <Link to="/app/settings">Settings → Use real data</Link> when your API
          is up. LLM preset: <strong>{llm.provider}</strong> · {llm.model}.
        </p>
      ) : (
        <p className="info-banner">
          <Badge tone="active">Real data</Badge>{" "}
          Agents use Ollama first, then Claude if configured as fallback. Prefer{" "}
          <strong>Full auto</strong> to run through stages; ingest a company on{" "}
          <Link to="/app/knowledge">Knowledge</Link> first. Studio:{" "}
          <Link to="/app/carousels">Carousels</Link>.
        </p>
      )}

      {liveError ? (
        <p className="error-banner">
          API unreachable: {liveError}. Is <code>npm run api:dev</code> running
          on the URL in Settings?
        </p>
      ) : null}
      {error ? <p className="error-banner">{error}</p> : null}

      {!simulation && allPending && !liveError ? (
        <p className="info-banner">
          Live pipeline is idle — press <strong>Run workflow</strong> to advance
          from ContextIngestion (needs KB company data).
        </p>
      ) : null}

      {!simulation && studioPath && contentStage?.status === "completed" ? (
        <p className="info-banner">
          Content ready —{" "}
          <Link to={studioPath}>Open generated carousel in Open Carrusel</Link>
        </p>
      ) : null}

      {status.platforms.length === 0 && !simulation ? (
        <p className="info-banner">
          No platforms selected yet — PlatformSelection will default some, or set
          them on <Link to="/app/platforms">Platforms</Link>.
        </p>
      ) : null}

      <Progress active={processing || busy} label="Agents advancing the experiment loop" />

      <WorkflowStagesPanel status={status} />
    </div>
  );
}
