import type { IndicatorDefinition } from '@/core/registry/types';

/**
 * Provisional SRHR indicator registry.
 *
 * Every field here is configuration. In particular:
 *
 * - `source.dx` carries a real DHIS2 UID where the target instance actually
 *   defines that indicator, and `null` where it does not. A null mapping is
 *   skipped at synchronisation and reported in Admin, so the gap is visible
 *   rather than silently returning nothing. The mapped UIDs below were read from the
 *   reference DHIS2 instance's own metadata (8 indicators, 187 data elements)
 *   and must be re-confirmed against each programme state's instance before
 *   live use — UIDs are per-instance and do not transfer;
 *   the remainder need either a DHIS2 indicator defined for them or a mapping
 *   onto the underlying data elements, which is set in Admin → Indicators.
 * - `defaultTarget` values are placeholders pending the official ASPIRE-GAC
 *   targets, and are overridden per org unit and period by the targets table.
 */

const percentQuality = {
  min: 0,
  max: 100,
  numeratorMustNotExceedDenominator: true,
  maxPeriodChangePct: 60,
} as const;

/** A mapping onto a DHIS2 indicator UID on the configured instance. */
function dhis2(dx: string, datasetId = 'ds-srhr-core'): IndicatorDefinition['source'] {
  return { system: 'DHIS2', dx, datasetId, numeratorDx: null, denominatorDx: null };
}

function percentIndicator(
  init: Pick<
    IndicatorDefinition,
    'id' | 'name' | 'shortName' | 'description' | 'domainId' | 'defaultTarget'
  > &
    Partial<IndicatorDefinition>,
): IndicatorDefinition {
  return {
    unit: 'PERCENT',
    directionality: 'HIGHER_IS_BETTER',
    frequency: 'QUARTERLY',
    lowestLevel: 'FACILITY',
    disaggregations: ['age', 'sex'],
    scoring: { kind: 'TARGET_RATIO', cap: 100 },
    quality: { ...percentQuality },
    source: { system: 'DHIS2', dx: null, datasetId: 'ds-srhr-core', numeratorDx: null, denominatorDx: null },
    active: true,
    ...init,
  };
}

export const INDICATORS: IndicatorDefinition[] = [
  percentIndicator({
    id: 'anc4-coverage',
    name: 'Antenatal care, early first contact',
    shortName: 'ANC early contact',
    description:
      'Pregnant women reporting for antenatal care before 20 weeks, as a share of expected pregnancies.',
    domainId: 'maternal-health',
    defaultTarget: 75,
    source: dhis2('lHBIJsXmN6N'),
  }),
  percentIndicator({
    id: 'skilled-birth-attendance',
    name: 'Deliveries with a skilled birth attendant',
    shortName: 'Skilled delivery',
    description: 'Deliveries attended by a skilled health worker, as a share of expected deliveries.',
    domainId: 'maternal-health',
    defaultTarget: 80,
    source: dhis2('DD480KjzWyI'),
  }),
  percentIndicator({
    id: 'pnc-48h',
    name: 'Postnatal care within three days',
    shortName: 'PNC within 3 days',
    description: 'Women attending a postnatal clinic visit within three days of delivery.',
    domainId: 'maternal-health',
    defaultTarget: 70,
    source: dhis2('NbBhtRKOcNG'),
  }),
  {
    ...percentIndicator({
      id: 'partograph-monitoring',
      name: 'Deliveries monitored with a partograph',
      shortName: 'Partograph use',
      description:
        'Deliveries monitored using a partograph, a proxy for quality of intrapartum care.',
      domainId: 'maternal-health',
      defaultTarget: 85,
      source: dhis2('GatsIlJUfmd'),
    }),
  },

  {
    id: 'still-birth-rate',
    name: 'Still birth rate',
    shortName: 'Still births',
    description: 'Still births per 1,000 total births. A lower rate is better.',
    domainId: 'maternal-health',
    unit: 'RATE_PER_1000',
    directionality: 'LOWER_IS_BETTER',
    frequency: 'QUARTERLY',
    lowestLevel: 'FACILITY',
    disaggregations: [],
    defaultTarget: 10,
    scoring: { kind: 'LINEAR', floor: 30, ceiling: 0 },
    quality: { min: 0, max: 200, numeratorMustNotExceedDenominator: false, maxPeriodChangePct: 80 },
    source: dhis2('wBHe2MdXjPA'),
    active: true,
  },

  percentIndicator({
    id: 'mcpr',
    name: 'Modern contraceptive prevalence rate',
    shortName: 'mCPR',
    description: 'Women of reproductive age using a modern contraceptive method.',
    domainId: 'family-planning',
    defaultTarget: 35,
  }),
  {
    id: 'fp-new-acceptors',
    name: 'New family planning acceptors',
    shortName: 'New FP acceptors',
    description: 'Clients accepting a modern contraceptive method for the first time during the period.',
    domainId: 'family-planning',
    unit: 'COUNT',
    directionality: 'HIGHER_IS_BETTER',
    frequency: 'QUARTERLY',
    lowestLevel: 'FACILITY',
    disaggregations: ['age', 'method'],
    defaultTarget: 1200,
    scoring: { kind: 'TARGET_RATIO', cap: 100 },
    quality: { min: 0, max: null, numeratorMustNotExceedDenominator: false, maxPeriodChangePct: 80 },
    source: { system: 'DHIS2', dx: null, datasetId: 'ds-srhr-core', numeratorDx: null, denominatorDx: null },
    active: true,
  },
  percentIndicator({
    id: 'fp-counselling-coverage',
    name: 'Family planning counselling coverage',
    shortName: 'FP counselling',
    description: 'Eligible clients receiving documented family planning counselling.',
    domainId: 'family-planning',
    defaultTarget: 85,
  }),

  percentIndicator({
    id: 'adolescent-fp-uptake',
    name: 'Adolescent family planning uptake',
    shortName: 'Adolescent FP uptake',
    description: 'Adolescents aged 15–19 receiving a modern contraceptive method.',
    domainId: 'adolescent-srhr',
    defaultTarget: 25,
  }),
  percentIndicator({
    id: 'youth-friendly-services',
    name: 'Facilities offering youth-friendly services',
    shortName: 'Youth-friendly services',
    description: 'Service points meeting the youth-friendly service standard.',
    domainId: 'adolescent-srhr',
    defaultTarget: 60,
  }),
  percentIndicator({
    id: 'adolescent-anc1',
    name: 'Adolescent first antenatal contact',
    shortName: 'Adolescent ANC1',
    description: 'Pregnant adolescents aged 15–19 attending a first antenatal contact.',
    domainId: 'adolescent-srhr',
    defaultTarget: 65,
  }),

  percentIndicator({
    id: 'gbv-clinical-care',
    name: 'GBV survivors receiving clinical care',
    shortName: 'GBV clinical care',
    description: 'Reported survivors of gender-based violence who received the clinical care package.',
    domainId: 'gbv-response',
    defaultTarget: 80,
  }),
  percentIndicator({
    id: 'gbv-referral-completion',
    name: 'GBV referral completion',
    shortName: 'GBV referral completion',
    description: 'Referrals for survivors of gender-based violence confirmed as completed.',
    domainId: 'gbv-response',
    defaultTarget: 70,
  }),

  percentIndicator({
    id: 'hiv-test-pregnancy',
    name: 'HIV testing in pregnancy',
    shortName: 'HIV testing in pregnancy',
    description: 'Pregnant women tested for HIV and receiving their result during antenatal care.',
    domainId: 'hiv-sti',
    defaultTarget: 90,
  }),
  percentIndicator({
    id: 'sti-management',
    name: 'STI syndromic management',
    shortName: 'STI management',
    description: 'Presenting STI cases managed according to the national syndromic protocol.',
    domainId: 'hiv-sti',
    defaultTarget: 75,
  }),

  {
    id: 'contraceptive-stockout',
    name: 'Contraceptive stock-out rate',
    shortName: 'Contraceptive stock-outs',
    description: 'Share of service points reporting a stock-out of any tracer contraceptive during the period.',
    domainId: 'commodity-security',
    unit: 'PERCENT',
    directionality: 'LOWER_IS_BETTER',
    frequency: 'QUARTERLY',
    lowestLevel: 'FACILITY',
    disaggregations: ['method'],
    defaultTarget: 5,
    // LINEAR is direction-agnostic: a ceiling below the floor scores a falling
    // series highly, which is the correct reading for a stock-out rate.
    scoring: { kind: 'LINEAR', floor: 30, ceiling: 0 },
    quality: { ...percentQuality },
    source: { system: 'DHIS2', dx: null, datasetId: 'ds-srhr-commodities', numeratorDx: null, denominatorDx: null },
    active: true,
  },
  {
    ...percentIndicator({
      id: 'essential-medicines-availability',
      name: 'Essential SRHR medicines availability',
      shortName: 'Essential medicines',
      description: 'Service points with all tracer SRHR medicines available on the day of reporting.',
      domainId: 'commodity-security',
      defaultTarget: 90,
    }),
    source: {
      system: 'DHIS2',
      dx: null,
      datasetId: 'ds-srhr-commodities',
      numeratorDx: null,
      denominatorDx: null,
    },
  },
];

export const DATASETS = [
  { id: 'ds-srhr-core', name: 'SRHR core service delivery', periodType: 'QUARTERLY' as const, dueDays: 15 },
  { id: 'ds-srhr-commodities', name: 'SRHR commodities and logistics', periodType: 'QUARTERLY' as const, dueDays: 10 },
];
