/**
 * Deep merge where user-provided values always overwrite existing/scraped
 * values for conflicting fields. Non-conflicting existing fields are preserved.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function isSafeKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

/**
 * Merge `userProvided` into `existing`.
 * - Object fields: recurse
 * - Arrays / primitives: user value wins when the key is present in userProvided
 * - Keys only in existing: preserved unchanged
 * - Prototype-polluting keys (`__proto__`, etc.) are ignored
 */
export function deepMergeUserPrecedence<T extends Record<string, unknown>>(
  existing: T,
  userProvided: Partial<T> | Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...existing };

  for (const key of Object.keys(userProvided)) {
    if (!isSafeKey(key)) continue;
    const userVal = (userProvided as Record<string, unknown>)[key];
    // Explicit undefined means "leave existing" so Partial updates can omit fields.
    if (userVal === undefined) continue;

    const existingVal = result[key];
    if (isPlainObject(existingVal) && isPlainObject(userVal)) {
      result[key] = deepMergeUserPrecedence(existingVal, userVal);
    } else {
      // User-provided values always take precedence for conflicting fields
      result[key] = userVal;
    }
  }

  return result as T;
}

/**
 * Convenience alias matching the design doc naming.
 */
export function mergeKBValues<T extends Record<string, unknown>>(
  existing: T,
  userProvidedValues: Partial<T> | Record<string, unknown>,
): T {
  return deepMergeUserPrecedence(existing, userProvidedValues);
}
