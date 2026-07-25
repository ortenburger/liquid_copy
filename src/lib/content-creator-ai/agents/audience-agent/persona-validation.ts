/**
 * Persona validation (Task 7.1) — Requirement 4.5.
 *
 * Property 11 states this as an "if and only if": a persona is valid exactly
 * when `icpDefinition` is non-empty AND `painPoints` holds at least one
 * non-empty entry. No other field may influence the verdict.
 */
import type { AudiencePersona } from "../../types/index.js";

export interface PersonaValidationResult {
  valid: boolean;
  missingFields: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate a persona against the minimum required fields.
 *
 * Returns the missing field names so the operator can be told exactly what to
 * supply (Requirement 4.5) rather than a bare rejection.
 */
export function validatePersona(persona: unknown): PersonaValidationResult {
  const missingFields: string[] = [];
  const p = (persona ?? {}) as Partial<AudiencePersona>;

  if (!isNonEmptyString(p.icpDefinition)) missingFields.push("icpDefinition");

  const painPoints = Array.isArray(p.painPoints) ? p.painPoints : [];
  if (!painPoints.some(isNonEmptyString)) missingFields.push("painPoints");

  return { valid: missingFields.length === 0, missingFields };
}

/** Operator-facing message naming the missing required fields. */
export function describeMissingPersonaFields(
  result: PersonaValidationResult,
): string {
  if (result.valid) return "";
  const labels: Record<string, string> = {
    icpDefinition: "an ICP definition",
    painPoints: "at least one pain point",
  };
  const parts = result.missingFields.map((f) => labels[f] ?? f);
  return `The persona is missing ${parts.join(" and ")}.`;
}
