import { useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { TextArea } from "../ui/Input";
import { ParsedOutput } from "./ParsedOutput";
import type {
  ApprovalCheckpointStage,
  CheckpointRecord,
  CheckpointStatus,
} from "../../lib/types";

function toneFor(status: CheckpointStatus) {
  if (status === "approved" || status === "edited") return "active" as const;
  if (status === "waiting") return "processing" as const;
  if (status === "rejected" || status === "auto_escalated")
    return "failed" as const;
  return "idle" as const;
}

export interface CheckpointRowProps {
  checkpoint: CheckpointRecord;
  busy?: boolean;
  onAction: (
    stage: ApprovalCheckpointStage,
    action: "approve" | "reject" | "edit" | "enable" | "disable",
    payload?: { instructions?: string; notes?: string },
  ) => void;
}

export function CheckpointRow({
  checkpoint: cp,
  busy = false,
  onAction,
}: CheckpointRowProps) {
  const [instructions, setInstructions] = useState("");

  return (
    <li className="list-row">
      <div className="list-row-main">
        <div className="list-row-title">
          <span>{cp.stage}</span>
          <Badge tone={toneFor(cp.status)}>{cp.status}</Badge>
          <Badge tone={cp.enabled ? "active" : "idle"}>
            {cp.enabled ? "enabled" : "disabled"}
          </Badge>
        </div>
        {cp.pendingOutput ? (
          <ParsedOutput raw={cp.pendingOutput} stage={cp.stage} />
        ) : null}
        {cp.status === "waiting" || cp.status === "rejected" ? (
          <TextArea
            label="Regeneration instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Required when rejecting…"
          />
        ) : null}
      </div>
      <div className="list-row-actions">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            onAction(cp.stage, cp.enabled ? "disable" : "enable")
          }
        >
          {cp.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          variant="primary"
          disabled={busy || cp.status !== "waiting"}
          onClick={() => onAction(cp.stage, "approve")}
        >
          Approve
        </Button>
        <Button
          variant="ghost"
          disabled={busy || cp.status !== "waiting"}
          onClick={() =>
            onAction(cp.stage, "edit", {
              notes: instructions || "Edited inline",
            })
          }
        >
          Edit
        </Button>
        <Button
          variant="accent"
          disabled={
            busy || (cp.status !== "waiting" && cp.status !== "rejected")
          }
          onClick={() =>
            onAction(cp.stage, "reject", { instructions })
          }
        >
          Reject
        </Button>
      </div>
    </li>
  );
}
