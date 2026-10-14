import type { OrgLevel } from '@/core/model/types';

/**
 * Level names as the interface shows them. The federal tier aggregates only the
 * programme states, not the whole country, so it is "Federal", not "National".
 * Kept out of the client components so server components can read it too.
 */
export const LEVEL_LABEL: Record<OrgLevel, string> = {
  COUNTRY: 'Federal',
  STATE: 'State',
  LGA: 'LGA',
  WARD: 'Ward',
  FACILITY: 'Facility',
};
