import type { IndicatorDefinition } from './types';

/**
 * Whether an indicator has a source to fetch from: a DHIS2 indicator or data
 * element (`dx`), or a numerator and denominator calculated from data elements.
 */
export function isMapped(indicator: IndicatorDefinition): boolean {
  const { dx, numeratorDx, denominatorDx } = indicator.source;
  return Boolean(dx) || (Boolean(numeratorDx) && Boolean(denominatorDx));
}

/** How the mapping reads in the interface: the UID, or "numerator ÷ denominator". */
export function mappingLabel(indicator: IndicatorDefinition): string | null {
  const { dx, numeratorDx, denominatorDx } = indicator.source;
  if (dx) return dx;
  if (numeratorDx && denominatorDx) return `${numeratorDx} ÷ ${denominatorDx}`;
  return null;
}
