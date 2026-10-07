/**
 * Snapshot serialisation for `audit_logs.before_json` / `after_json`.
 *
 * Pure, so it is unit-testable. It exists because the rows being snapshotted
 * contain values a Prisma `Json` column cannot take directly: money is `BIGINT`
 * (so a `bigint` in JS, which `JSON.stringify` throws on) and timestamps come
 * back as `Date`.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Converts an arbitrary row snapshot to something a `Json` column accepts.
 *
 * `bigint` becomes a number while it is exactly representable — which is
 * always true for money that passed `assertCents` — and a string beyond that,
 * so an audit entry degrades to a readable value rather than throwing. `Date`
 * becomes an ISO 8601 string. `undefined` keys are dropped, as `JSON.stringify`
 * would do.
 */
export function toAuditJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
      return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    case "function":
    case "symbol":
      return null;
    default:
      break;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toAuditJson(entry));
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), toAuditJson(entry)]),
    );
  }

  if (value instanceof Set) {
    return [...value].map((entry) => toAuditJson(entry));
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined) {
      result[key] = toAuditJson(entry);
    }
  }
  return result;
}
