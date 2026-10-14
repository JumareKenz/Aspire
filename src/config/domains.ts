import type { DomainDefinition } from '@/core/registry/types';

/**
 * SRHR programme domains.
 *
 * These are configuration, not code. The official ASPIRE-GAC domain structure
 * has not been supplied; this set is a workable provisional structure and is
 * replaced by editing this file or by loading domains from the admin interface.
 */
export const DOMAINS: DomainDefinition[] = [
  {
    id: 'maternal-health',
    name: 'Maternal health',
    description: 'Antenatal care, skilled delivery and postnatal follow-up.',
    order: 1,
  },
  {
    id: 'family-planning',
    name: 'Family planning',
    description: 'Contraceptive uptake, method mix and continuity of supply.',
    order: 2,
  },
  {
    id: 'adolescent-srhr',
    name: 'Adolescent SRHR',
    description: 'Access to and uptake of sexual and reproductive health services by adolescents.',
    order: 3,
  },
  {
    id: 'gbv-response',
    name: 'GBV response',
    description: 'Clinical care and referral completion for survivors of gender-based violence.',
    order: 4,
  },
  {
    id: 'hiv-sti',
    name: 'HIV and STI services',
    description: 'Testing coverage in pregnancy and management of sexually transmitted infections.',
    order: 5,
  },
  {
    id: 'commodity-security',
    name: 'Commodity security',
    description: 'Availability of contraceptives and essential SRHR medicines at service points.',
    order: 6,
  },
];

/**
 * Domains listed ahead of the alphabetical order in the data element catalogue.
 * Adolescent SRHR is the programme's priority population, so its data elements
 * come first; every other domain follows alphabetically.
 */
export const PRIORITY_DOMAIN_IDS = ['adolescent-srhr'];
