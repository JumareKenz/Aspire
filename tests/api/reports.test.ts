import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aspire-reports-'));
process.env.ASPIRE_DB_PATH = join(dir, 'test.db');

const { closeDb } = await import('@/data/db/client');
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { generateReport, REPORT_TYPES } = await import('@/services/reports');
const { getRootOrgUnit } = await import('@/data/repositories/orgUnits');
const { latestCompletePeriodId } = await import('@/data/sync/periods');
const { getScorecard } = await import('@/services/scorecards');

let rootId: string;
let periodId: string;

beforeAll(async () => {
  await ensureBootstrapped();
  rootId = getRootOrgUnit()!.id;
  periodId = latestCompletePeriodId();
}, 120_000);

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('report generation', () => {
  it.each(REPORT_TYPES)('generates a %s with content', (type) => {
    const report = generateReport(type, rootId, periodId);
    expect(report).not.toBeNull();
    expect(report!.sections.length).toBeGreaterThan(0);
    for (const section of report!.sections) {
      expect(section.heading).toBeTruthy();
      expect(section.paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) expect(paragraph.trim().length).toBeGreaterThan(0);
    }
  });

  it('stamps provenance on every report, so a printed copy stays honest', () => {
    for (const type of REPORT_TYPES) {
      const report = generateReport(type, rootId, periodId)!;
      expect(report.provenance.mode).toBe('DEMO');
      expect(report.provenance.sourceLabel).toBeTruthy();
      expect(report.provenance.methodologyVersion).toBe('ASPIRE-SRHR-PROVISIONAL-v0');
      expect(report.provenance.methodologyStatus).toBe('PROVISIONAL');
      expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('quotes the same figures the scorecard shows', () => {
    const card = getScorecard(rootId, periodId)!;
    const brief = generateReport('EXECUTIVE_BRIEF', rootId, periodId)!;
    const text = brief.sections.flatMap((section) => section.paragraphs).join(' ');
    expect(text).toContain(String(card.overallScore));
    expect(text).toContain(String(card.dataConfidence.score));
  });

  it('states performance and data confidence as separate measures', () => {
    const brief = generateReport('EXECUTIVE_BRIEF', rootId, periodId)!;
    const guidance = brief.sections.find((section) => section.heading === 'How to read this')!;
    expect(guidance.paragraphs.join(' ')).toMatch(/separate measures/i);
  });

  it('builds the quarterly report’s scorecard table from the domains, in order', () => {
    const card = getScorecard(rootId, periodId)!;
    const report = generateReport('QUARTERLY_PERFORMANCE', rootId, periodId)!;
    const table = report.sections.find((section) => section.table?.caption.includes('scorecard'))!.table!;
    expect(table.rows).toHaveLength(card.domains.length);
    expect(table.rows.map((row) => row[0])).toEqual(card.domains.map((domain) => domain.name));
  });

  it('lists every indicator in the area report', () => {
    const card = getScorecard(rootId, periodId)!;
    const report = generateReport('AREA_PERFORMANCE', rootId, periodId)!;
    const rows = report.sections.flatMap((section) => section.table?.rows ?? []);
    const indicatorCount = card.domains.reduce((total, domain) => total + domain.indicators.length, 0);
    expect(rows).toHaveLength(indicatorCount);
  });

  it('says plainly when there is nothing to report rather than padding', () => {
    const report = generateReport('INTELLIGENCE_SUMMARY', rootId, periodId)!;
    for (const section of report.sections) {
      expect(section.paragraphs.join(' ')).not.toMatch(/lorem|placeholder|TODO/i);
    }
  });

  it('returns null for a geography with no stored reporting', () => {
    expect(generateReport('EXECUTIVE_BRIEF', 'no-such-unit', periodId)).toBeNull();
  });
});
