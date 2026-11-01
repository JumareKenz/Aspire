/**
 * Applies a partial update, leaving a field alone when its value is undefined.
 *
 * API routes pass every optional field along, so one a request left out arrives
 * as an explicit `undefined`, and a plain spread would overwrite the stored
 * value with it. `null` is a real value: it is how an assignee is cleared.
 */
export function mergeDefined<T extends object>(existing: T, changes: Partial<T>): T {
  const defined = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  );
  return { ...existing, ...defined };
}
