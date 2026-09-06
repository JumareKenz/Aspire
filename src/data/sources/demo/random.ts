/**
 * Deterministic pseudo-random number generation.
 *
 * The demo dataset must be identical on every machine and every run, so that
 * screenshots, tests and the AI evaluation set all describe the same numbers.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, so seeds can be derived from identifiers. */
export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Approximately normal deviate via the sum of twelve uniforms. */
export function gaussian(rng: () => number): number {
  let total = 0;
  for (let i = 0; i < 12; i += 1) total += rng();
  return total - 6;
}
