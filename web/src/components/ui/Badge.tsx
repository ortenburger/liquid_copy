import type { ReactNode } from "react";
import "./Badge.css";

type Tone = "active" | "processing" | "failed" | "idle";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = "idle", children }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, children }: ChipProps) {
  const interactive = Boolean(onClick);
  if (interactive) {
    return (
      <button
        type="button"
        className={`chip ${selected ? "chip-selected" : ""}`}
        onClick={onClick}
        aria-pressed={selected}
      >
        {children}
      </button>
    );
  }
  return <span className={`chip ${selected ? "chip-selected" : ""}`}>{children}</span>;
}
