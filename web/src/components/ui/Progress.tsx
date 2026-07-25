import "./Progress.css";

interface ProgressProps {
  active?: boolean;
  label?: string;
}

/** Indeterminate crimson “liquid” loading bar. */
export function Progress({ active = true, label }: ProgressProps) {
  if (!active) return null;
  return (
    <div className="progress" role="progressbar" aria-label={label ?? "Loading"}>
      <div className="progress-track">
        <div className="progress-liquid" />
      </div>
      {label ? <span className="progress-label">{label}</span> : null}
    </div>
  );
}

/** Pulsing block caret for streaming AI text. */
export function StreamingCaret() {
  return <span className="stream-caret" aria-hidden />;
}
