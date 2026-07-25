import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import "./Input.css";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  ai?: boolean;
}

export function Input({ label, ai = false, className = "", id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <span className={`field-control ${ai ? "field-ai" : ""}`}>
        <input id={inputId} className="field-input" {...props} />
        {ai ? <span className="ai-caret" aria-hidden /> : null}
      </span>
    </label>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function TextArea({ label, className = "", id, ...props }: TextAreaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field-label">{label}</span> : null}
      <textarea id={inputId} className="field-input field-textarea" {...props} />
    </label>
  );
}
