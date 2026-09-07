import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, dropSchema, isolatedSchema } from '../helpers/db';

const schema = isolatedSchema();
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { generateReport, REPORT_TYPES } = await import('@/services/reports');
const { getRootOrgUnit } = await import('@/data/repositories/orgUnits');
const { latestCompletePeriodId } = await import('@/data/sync/periods');
const { getScorecard } = await import('@/services/scorecards');

let rootId: string;
let periodId: string;

beforeAll(async () => {
  await createSchema(schema);
  await ensureBootstrapped();
  rootId = (await getRootOrgUnit())!.id;
  periodId = latestCompletePeriodId();
}, 120_000);

afterAll(async () => {
  await dropSchema(schema);
});

describe('report generation', () => {
  it.each(REPORT_TYPES)('generates a %s with content', async (type) => {
    const report = await generateReport(type, rootId, periodId);
    expect(report).not.toBeNull();
    expect(report!.sections.length).toBeGreaterThan(0);
    for (const section of report!.sections) {
      expect(section.heading).toBeTruthy();
      expect(section.paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) expect(paragraph.trim().length).toBeGreaterThan(0);
    }
  });

  it('stamps provenance on every report, so a printed copy stays honest', async () => {
    for (const type of REPORT_TYPES) {
      const report = (await generateReport(type, rootId, periodId))!;
      expect(report.provenance.mode).toBe('DEMO');
      expect(report.provenance.sourceLabel).toBeTruthy();
      expect(report.provenance.methodologyVersion).toBe('ASPIRE-SRHR-PROVISIONAL-v0');
      expect(report.provenance.methodologyStatus).toBe('PROVISIONAL');
      expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('quotes the same figures the scorecard shows', async () => {
    const card = (await getScorecard(rootId, periodId))!;
    const brief = (await generateReport('EXECUTIVE_BRIEF', rootId, periodId))!;
    const text = brief.sections.flatMap((section) => section.paragraphs).join(' ');
    expect(text).toContain(String(card.overallScore));
    expect(text).toContain(String(card.dataConfidence.score));
  });

  it('states performance and data confidence as separate measures', async () => {
    const brief = (await generateReport('EXECUTIVE_BRIEF', rootId, periodId))!;
    const guidance = brief.sections.find((section) => section.heading === 'How to read this')!;
    expect(guidance.paragraphs.join(' ')).toMatch(/separate measures/i);
  });

  it('builds the quarterly report’s scorecard table from the domains, in order', async () => {
    const card = (await getScorecard(rootId, periodId))!;
    const report = (await generateReport('QUARTERLY_PERFORMANCE', rootId, periodId))!;
    const table = report.sections.find((section) => section.table?.caption.includes('scorecard'))!.table!;
    expect(table.rows).toHaveLength(card.domains.length);
    expect(table.rows.map((row) => row[0])).toEqual(card.domains.map((domain) => domain.name));
  });

  it('lists every indicator in the area report', async () => {
    const card = (await getScorecard(rootId, periodId))!;
    const report = (await generateReport('AREA_PERFORMANCE', rootId, periodId))!;
    const rows = report.sections.flatMap((section) => section.table?.rows ?? []);
    const indicatorCount = card.domains.reduce((total, domain) => total + domain.indicators.length, 0);
    expect(rows).toHaveLength(indicatorCount);
  });

  it('says plainly when there is nothing to report rather than padding', async () => {
    const report = (await generateReport('INTELLIGENCE_SUMMARY', rootId, periodId))!;
    for (const section of report.sections) {
      expect(section.paragraphs.join(' ')).not.toMatch(/lorem|placeholder|TODO/i);
    }
  });

  it('returns null for a geography with no stored reporting', async () => {
    expect(await generateReport('EXECUTIVE_BRIEF', 'no-such-unit', periodId)).toBeNull();
  });
});

describe('the cross-state comparison report', () => {
  it('is refused where there is nothing to compare', async () => {
    // Asked inside a single state, there is no second state beneath the
    // selection, so the report is not produced at all rather than produced
    // with one column.
    expect(await generateReport('STATE_COMPARISON', 'state-bauchi', periodId)).toBeNull();
  });

  it('names both states and puts every domain in the table', async () => {
    const report = (await generateReport('STATE_COMPARISON', rootId, periodId))!;
    const domainSection = report.sections.find((section) => section.heading === 'By domain')!;
    expect(domainSection.table!.columns).toEqual(
      expect.arrayContaining(['Bauchi State', 'Sokoto State']),
    );
    expect(domainSection.table!.rows.length).toBeGreaterThan(1);
    // A row per domain, with a figure for each state and a difference.
    for (const row of domainSection.table!.rows) {
      expect(row).toHaveLength(domainSection.table!.columns.length);
    }
  });

  it('quotes the same state scores the scorecards hold', async () => {
    const report = (await generateReport('STATE_COMPARISON', rootId, periodId))!;
    const overall = report.sections.find((section) => section.heading === 'Overall')!;
    for (const stateId of ['state-bauchi', 'state-sokoto']) {
      const card = (await getScorecard(stateId, periodId))!;
      const row = overall.table!.rows.find((entry) => entry[0] === card.orgUnitName)!;
      expect(row).toBeDefined();
      expect(row[1]).toBe(card.overallScore);
      expect(row[4]).toBe(card.dataConfidence.score);
    }
  });

  it('says plainly when nothing is diverging rather than padding the section', async () => {
    const report = (await generateReport('STATE_COMPARISON', rootId, periodId))!;
    const section = report.sections.find(
      (entry) => entry.heading === 'Moving in opposite directions',
    )!;
    if (!section.table) {
      expect(section.paragraphs[0]).toContain('No domain');
    } else {
      expect(section.table.rows.length).toBeGreaterThan(0);
    }
  });
});

describe('report types are an intersection of role and scope', () => {
  it('withholds the cross-state report from a single-state user of any role', async () => {
    const { reportTypesFor } = await import('@/auth/experience');
    for (const role of ['EXECUTIVE', 'ANALYST', 'ADMIN'] as const) {
      expect(reportTypesFor({ role }, 1)).not.toContain('STATE_COMPARISON');
      expect(reportTypesFor({ role }, 0)).not.toContain('STATE_COMPARISON');
      expect(reportTypesFor({ role }, 2)).toContain('STATE_COMPARISON');
    }
  });

  it('does not let scope widen what a role may produce', async () => {
    const { reportTypesFor } = await import('@/auth/experience');
    // A global executive gains the comparison and nothing else: holding two
    // states does not turn an executive into an analyst.
    expect(reportTypesFor({ role: 'EXECUTIVE' }, 2)).not.toContain('DATA_QUALITY');
    expect(reportTypesFor({ role: 'EXECUTIVE' }, 2)).not.toContain('AREA_PERFORMANCE');
  });
});
