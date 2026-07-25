import { Badge } from "../ui/Badge";
import type {
  HypothesisCard,
  OrgGoal,
  OrgProfile,
  RoadmapSummary,
} from "../../lib/types";
import "./ParsedOutput.css";

function tryParse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    !(trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    !trimmed.startsWith('"')
  ) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isRoadmap(v: unknown): v is RoadmapSummary {
  return (
    isRecord(v) &&
    Array.isArray(v.weeks) &&
    (typeof v.title === "string" || typeof v.summary === "string")
  );
}

function isHypothesisList(v: unknown): v is HypothesisCard[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (h) =>
        isRecord(h) &&
        typeof h.hook === "string" &&
        (typeof h.platform === "string" || h.platform === undefined),
    )
  );
}

function isOrgProfile(v: unknown): v is OrgProfile {
  return (
    isRecord(v) &&
    typeof v.name === "string" &&
    typeof v.mission === "string" &&
    typeof v.brandVoice === "string"
  );
}

function isOrgGoal(v: unknown): v is OrgGoal {
  return (
    isRecord(v) &&
    typeof v.primaryObjective === "string" &&
    typeof v.targetPlatform === "string"
  );
}

function labelKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="parsed-muted">—</span>;
  }
  if (typeof value === "boolean") {
    return <Badge tone={value ? "active" : "idle"}>{String(value)}</Badge>;
  }
  if (typeof value === "number") {
    return <span className="parsed-mono">{value}</span>;
  }
  return <span>{String(value)}</span>;
}

function GenericObject({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  return (
    <dl className="parsed-dl">
      {entries.map(([key, value]) => (
        <div key={key} className="parsed-row">
          <dt>{labelKey(key)}</dt>
          <dd>
            {Array.isArray(value) ? (
              value.every((x) => typeof x !== "object") ? (
                <ul className="parsed-chips">
                  {value.map((item, i) => (
                    <li key={i}>
                      <Badge tone="idle">{String(item)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="parsed-nested">
                  {value.map((item, i) =>
                    isRecord(item) ? (
                      <GenericObject key={i} data={item} />
                    ) : (
                      <PrimitiveValue key={i} value={item} />
                    ),
                  )}
                </div>
              )
            ) : isRecord(value) ? (
              <GenericObject data={value} />
            ) : (
              <PrimitiveValue value={value} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RoadmapView({ data }: { data: RoadmapSummary }) {
  return (
    <div className="parsed-block">
      <div className="parsed-heading">
        <strong>{data.title || "Roadmap"}</strong>
        <Badge tone="processing">{data.weeks.length} weeks</Badge>
      </div>
      {data.summary ? <p className="parsed-lead">{data.summary}</p> : null}
      <ul className="parsed-weeks">
        {data.weeks.map((w) => (
          <li key={w.week}>
            <span className="parsed-week-label">
              Week {w.week}
              {w.theme ? ` · ${w.theme}` : ""}
            </span>
            <p>{w.objective}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HypothesesView({ data }: { data: HypothesisCard[] }) {
  return (
    <ul className="parsed-hyp-list">
      {data.map((h, i) => (
        <li key={h.id || i} className="parsed-hyp">
          <div className="parsed-heading">
            <strong>{h.title || h.hook}</strong>
            {h.status ? <Badge tone="processing">{h.status}</Badge> : null}
            {h.platform ? <Badge tone="idle">{h.platform}</Badge> : null}
          </div>
          {h.title ? (
            <p>
              <span className="parsed-muted">Hook</span> {h.hook}
            </p>
          ) : null}
          {h.angle ? <p className="parsed-lead">{h.angle}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function OrgProfileView({ data }: { data: OrgProfile }) {
  return (
    <div className="parsed-block">
      <div className="parsed-heading">
        <strong>{data.name || "Organization"}</strong>
        {data.industry ? <Badge tone="idle">{data.industry}</Badge> : null}
      </div>
      {data.website ? (
        <p className="parsed-muted">{data.website}</p>
      ) : null}
      <dl className="parsed-dl">
        <div className="parsed-row">
          <dt>Mission</dt>
          <dd>{data.mission}</dd>
        </div>
        <div className="parsed-row">
          <dt>Brand voice</dt>
          <dd>{data.brandVoice}</dd>
        </div>
        {data.values?.length ? (
          <div className="parsed-row">
            <dt>Values</dt>
            <dd>
              <ul className="parsed-chips">
                {data.values.map((v) => (
                  <li key={v}>
                    <Badge tone="idle">{v}</Badge>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function OrgGoalView({ data }: { data: OrgGoal }) {
  return (
    <div className="parsed-block">
      <div className="parsed-heading">
        <strong>Goal</strong>
        <Badge tone="active">{data.status}</Badge>
        <Badge tone="idle">{data.targetPlatform}</Badge>
      </div>
      <p className="parsed-lead">{data.primaryObjective}</p>
      {data.successMetrics?.length ? (
        <ul className="parsed-weeks">
          {data.successMetrics.map((m, i) => (
            <li key={i}>
              <span className="parsed-week-label">{m.name}</span>
              <p>
                {m.direction} to {m.numericTarget} · {m.timePeriod}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface ParsedOutputProps {
  raw: string;
  /** Optional hint from checkpoint stage for better layout. */
  stage?: string;
  className?: string;
}

/** Render JSON pending output as structured UI; fall back to plain text. */
export function ParsedOutput({ raw, stage, className = "" }: ParsedOutputProps) {
  const parsed = tryParse(raw);

  if (parsed === null) {
    return (
      <p className={`parsed-plain ${className}`.trim()}>{raw}</p>
    );
  }

  if (isRoadmap(parsed) || stage === "RoadmapReview") {
    if (isRoadmap(parsed)) {
      return (
        <div className={className}>
          <RoadmapView data={parsed} />
        </div>
      );
    }
  }

  if (isHypothesisList(parsed) || stage === "HypothesisReview") {
    if (isHypothesisList(parsed)) {
      return (
        <div className={className}>
          <HypothesesView data={parsed} />
        </div>
      );
    }
  }

  if (isOrgProfile(parsed) || stage === "ContextReview") {
    if (isOrgProfile(parsed)) {
      return (
        <div className={className}>
          <OrgProfileView data={parsed} />
        </div>
      );
    }
  }

  if (isOrgGoal(parsed) || stage === "GoalReview") {
    if (isOrgGoal(parsed)) {
      return (
        <div className={className}>
          <OrgGoalView data={parsed} />
        </div>
      );
    }
  }

  if (Array.isArray(parsed)) {
    if (parsed.every((x) => typeof x !== "object")) {
      return (
        <ul className={`parsed-chips ${className}`.trim()}>
          {parsed.map((item, i) => (
            <li key={i}>
              <Badge tone="idle">{String(item)}</Badge>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className={`parsed-nested ${className}`.trim()}>
        {parsed.map((item, i) =>
          isRecord(item) ? (
            <div key={i} className="parsed-block">
              <GenericObject data={item} />
            </div>
          ) : (
            <PrimitiveValue key={i} value={item} />
          ),
        )}
      </div>
    );
  }

  if (isRecord(parsed)) {
    return (
      <div className={`parsed-block ${className}`.trim()}>
        <GenericObject data={parsed} />
      </div>
    );
  }

  return (
    <p className={`parsed-plain ${className}`.trim()}>{String(parsed)}</p>
  );
}
