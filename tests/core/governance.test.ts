import { describe, expect, it } from 'vitest';
import {
  classifyIndicator,
  isReportable,
  parseExpression,
  type CatalogueEntry,
  type ProvenanceContext,
} from '@/core/registry/provenance';
import { groupByDomain, orderDomains } from '@/core/registry/ordering';
import { INDICATORS } from '@/config/indicators';
import { DOMAINS, PRIORITY_DOMAIN_IDS } from '@/config/domains';
import type { IndicatorDefinition } from '@/core/registry/types';

const FORM = 'O82o1WlMisO';

/** A realistic slice of the NHMIS 2019 form, plus elements that are not on it. */
function context(overrides: Partial<ProvenanceContext> = {}): ProvenanceContext {
  const catalogue = new Map<string, CatalogueEntry>(
    [
      ['FHmQPDbgyYZ', 'Still births'],
      ['YjZiHDKMWCJ', 'Live Births'],
      ['N70qtdTZ21W', 'Deliveries'],
      ['HDmaff9ZJls', 'Females using modern contraception'],
      ['mvBO08ctlWw', 'New FP Acceptors'],
      ['aNcFirstVis', 'ANC 1st visit'],
      ['aNcBefore20', 'ANC 1st visit before 20 weeks'],
    ].map(([id, name]) => [id, { id, name, formIds: [FORM] }]),
  );
  return {
    forms: [{ id: FORM, name: 'NHMIS Monthly Summary Form (Version 2019)' }],
    catalogue,
    sourceIndicators: new Map([
      ['xIvjr5gGVpp', { id: 'xIvjr5gGVpp', name: 'ANC before 20 weeks rate', numerator: '#{aNcBefore20}', denominator: '#{aNcFirstVis}' }],
      // An "NHMIS"-named indicator whose denominator is a population estimate.
      ['M8XUQAbJ3us', { id: 'M8XUQAbJ3us', name: 'NHMIS mCPR', numerator: '#{HDmaff9ZJls}', denominator: '#{PopWomn1549}*0.25' }],
      ['cfgIndicat1', { id: 'cfgIndicat1', name: 'Adolescent SRHR constant', numerator: 'C{abcdefghijk}', denominator: '1' }],
    ]),
    optionCombos: new Map([['ynM4SNxMDEL', '10-14 years']]),
    exceptions: [],
    ...overrides,
  };
}

const byId = (id: string) => INDICATORS.find((indicator) => indicator.id === id)!;

describe('NHMIS provenance', () => {
  it('reads every operand kind in a DHIS2 expression, including ones it does not trust', () => {
    const operands = parseExpression(
      '#{FHmQPDbgyYZ}+#{N70qtdTZ21W.lwoUMO6gkZ3}+#{YjZiHDKMWCJ.*}+R{O82o1WlMisO.REPORTING_RATE}+C{abcdefghijk}+OUG{abcdefghijk}+D{abcdefghijk.abcdefghijk}+[days]+X{zz}',
      'NUMERATOR',
    );
    expect(operands.map((operand) => operand.kind)).toEqual([
      'DATA_ELEMENT',
      'DATA_ELEMENT',
      'DATA_ELEMENT',
      'REPORTING_RATE',
      'CONSTANT',
      'ORG_UNIT_GROUP',
      'PROGRAM',
      'DAYS',
      'UNKNOWN',
    ]);
    expect(operands[1]).toMatchObject({ ref: 'N70qtdTZ21W.lwoUMO6gkZ3', dataElementId: 'N70qtdTZ21W', optionComboId: 'lwoUMO6gkZ3' });
    // "uid.*" is the element's total.
    expect(operands[2]).toMatchObject({ ref: 'YjZiHDKMWCJ', optionComboId: null });
  });

  it('verifies a rate calculated from data elements on the approved form', () => {
    const result = classifyIndicator(byId('still-birth-rate'), context());
    expect(result.status).toBe('VERIFIED');
    expect(result.sourceKind).toBe('CALCULATED');
    expect(result.operands.every((operand) => operand.verified)).toBe(true);
    expect(result.operands.map((operand) => operand.role)).toEqual(['NUMERATOR', 'DENOMINATOR', 'DENOMINATOR']);
  });

  it('verifies a DHIS2 indicator only after reading its definition', () => {
    const result = classifyIndicator(byId('anc4-coverage'), context());
    expect(result.status).toBe('VERIFIED');
    expect(result.sourceKind).toBe('SOURCE_INDICATOR');
    expect(result.operands.map((operand) => operand.name)).toEqual([
      'ANC 1st visit before 20 weeks',
      'ANC 1st visit',
    ]);
  });

  it('does not trust a name: an "NHMIS" indicator drawing on a population estimate is excluded', () => {
    const result = classifyIndicator(byId('mcpr'), context());
    expect(result.status).toBe('UNVERIFIED');
    expect(result.reasons.join(' ')).toMatch(/PopWomn1549.*not on an approved NHMIS form/);
    expect(isReportable(result.status)).toBe(false);
  });

  it('excludes a data element that is not on an approved form, whatever it is called', () => {
    const adolescent: IndicatorDefinition = {
      ...byId('adolescent-anc1'),
      id: 'named-adolescent',
      source: { system: 'DHIS2', dx: 'NHMISadol01', datasetId: FORM, numeratorDx: null, denominatorDx: null },
    };
    const result = classifyIndicator(adolescent, context());
    expect(result.status).toBe('UNVERIFIED');
  });

  it('excludes an indicator built only from constants, and one whose form is not approved', () => {
    const constant = classifyIndicator(
      { ...byId('anc4-coverage'), id: 'cfg', source: { ...byId('anc4-coverage').source, dx: 'cfgIndicat1' } },
      context(),
    );
    expect(constant.status).toBe('UNVERIFIED');
    expect(constant.reasons.join(' ')).toMatch(/configured constant/);

    const otherForm = classifyIndicator(
      { ...byId('still-birth-rate'), source: { ...byId('still-birth-rate').source, datasetId: 'NHMIS2025xx' } },
      context(),
    );
    expect(otherForm.status).toBe('UNVERIFIED');
  });

  it('accepts a non-form operand only through an explicit exception, and says so', () => {
    const result = classifyIndicator(
      byId('mcpr'),
      context({
        exceptions: [
          { indicatorId: 'mcpr', ref: 'PopWomn1549', reason: 'Population denominator approved by M&E TWG', approvedBy: 'TWG', approvedOn: '2026-10-01' },
        ],
      }),
    );
    expect(result.status).toBe('APPROVED_EXCEPTION');
    expect(result.operands.find((operand) => operand.ref === 'PopWomn1549')?.exception).toMatch(/TWG/);
    expect(isReportable(result.status)).toBe(true);
  });

  it('marks an indicator with no source as unmapped, and a breakdown off the form blocks verification', () => {
    expect(classifyIndicator(byId('youth-friendly-services'), context()).status).toBe('UNMAPPED');
    const withBreakdown = classifyIndicator(byId('adolescent-fp-uptake'), context());
    expect(withBreakdown.status).toBe('VERIFIED');
    expect(withBreakdown.operands.find((operand) => operand.role === 'NUMERATOR')?.name).toBe(
      'Females using modern contraception — 10-14 years',
    );
    const offForm = classifyIndicator(byId('skilled-birth-attendance'), context({ sourceIndicators: new Map() }));
    expect(offForm.status).toBe('UNVERIFIED');
  });
});

describe('data element ordering', () => {
  it('puts the adolescent domain first, then the rest alphabetically', () => {
    const ordered = orderDomains(DOMAINS, PRIORITY_DOMAIN_IDS).map((domain) => domain.id);
    expect(ordered[0]).toBe('adolescent-srhr');
    const rest = orderDomains(DOMAINS, PRIORITY_DOMAIN_IDS).slice(1).map((domain) => domain.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en-GB')));
  });

  it('groups by domain without duplicating, sorts within a group, and keeps unassigned last', () => {
    const groups = groupByDomain(
      [
        { id: 'a', name: 'Zinc', domainId: 'maternal-health' },
        { id: 'b', name: 'adolescent ANC', domainId: 'adolescent-srhr' },
        { id: 'c', name: 'Deliveries', domainId: 'maternal-health' },
        { id: 'd', name: 'Orphan', domainId: null },
        { id: 'e', name: 'Unknown domain', domainId: 'not-a-domain' },
        { id: 'f', name: 'Contraceptive users', domainId: 'family-planning' },
      ],
      DOMAINS,
      PRIORITY_DOMAIN_IDS,
    );
    expect(groups.map((group) => group.domainId)).toEqual(['adolescent-srhr', 'family-planning', 'maternal-health', null]);
    expect(groups[2].items.map((item) => item.name)).toEqual(['Deliveries', 'Zinc']);
    expect(groups[3].items.map((item) => item.id)).toEqual(['d', 'e']);
    expect(groups.flatMap((group) => group.items)).toHaveLength(6);
  });
});
