/**
 * Environment variable access that treats blank as absent.
 *
 * A deployment platform will happily store a variable whose value is the empty
 * string — creating one from a template with no value does exactly that. But
 * `''` is not `undefined`, so `process.env.X ?? fallback` returns `''` and the
 * fallback never fires. The failure is quiet and specific: an empty seed
 * password becomes the password, an empty file path becomes the current
 * directory.
 *
 * Reading env through here makes "declared but blank" behave the same as
 * "not declared", which is what every caller actually means.
 */
export function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Reads a variable, falling back when it is absent or blank. */
export function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

/** Reads a numeric variable, falling back when absent, blank or unparsable. */
export function envNumber(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** True only when the variable is explicitly the string `true`. */
export function envFlag(name: string): boolean {
  return env(name) === 'true';
}
