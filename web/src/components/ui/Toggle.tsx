import type { ButtonHTMLAttributes } from "react";
import "./Toggle.css";

interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}

/** Accessible switch for simulation / real mode and similar settings. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  className = "",
  disabled,
  ...props
}: ToggleProps) {
  return (
    <div className={`toggle-row ${className}`.trim()}>
      <div className="toggle-copy">
        <span className="toggle-label">{label}</span>
        {description ? <span className="toggle-desc">{description}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`toggle ${checked ? "is-on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        {...props}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}
