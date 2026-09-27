import ExcelJS from 'exceljs';
import { query } from '@/data/db/client';
import { listIndicators } from '@/data/repositories/registry';
import { lastSuccessfulSync } from '@/data/repositories/syncRuns';
import { readDhis2Config } from '@/data/sources/dhis2/client';
import { getCatalogue } from './explorer';

/**
 * The data quality export: every open finding, tied back to the DHIS2
 * indicator or data element it comes from, as a workbook to share with the
 * people who can fix the data at source.
 *
 * Counts are live formulas over the Findings sheet, each written with its
 * computed result too, so the numbers show in viewers that do not recalculate
 * and stay consistent in those that do.
 */

const TYPES: Record<string, { label: string; meaning: string; action: string }> = {
  CONSISTENCY: {
    label: 'Numerator above denominator',
    meaning: 'More cases were reported than the population they belong to (for example, more skilled deliveries than deliveries). The percentage is over 100%.',
    action: 'Check the numerator and denominator data elements for the facility and month: a mis-keyed figure, a value entered in the wrong field, or a denominator left blank.',
  },
  VALIDITY: {
    label: 'Impossible value',
    meaning: 'A value outside what is possible for the indicator, reported without its numerator and denominator.',
    action: 'Check the reported figure at source; look for extra digits or a value typed into the wrong row.',
  },
  REPEATED_VALUE: {
    label: 'Repeated value',
    meaning: 'The same figure reported for several periods in a row, which real service data rarely does.',
    action: 'Confirm the facility reported fresh figures each period rather than copying the previous one.',
  },
  STATISTICAL: {
    label: 'Statistical outlier',
    meaning: "A value far outside the area's usual range for the indicator.",
    action: "Check the facility-month behind the spike or drop; DHIS2's outlier detection (Admin → Data validation) names the facility.",
  },
  TEMPORAL: {
    label: 'Sudden level change',
    meaning: 'The reported level shifted abruptly and stayed there.',
    action: 'Check for a change in reporting (a new form, a facility added or removed) rather than a real change in services.',
  },
  COMPLETENESS: { label: 'Reporting gap', meaning: 'Expected reports were not submitted.', action: 'Follow up the facilities with missing submissions.' },
  TIMELINESS: { label: 'Late reporting', meaning: 'Reports arrived after their due date.', action: 'Follow up late-reporting facilities.' },
};
const SEVERITY: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const LEVEL: Record<string, string> = { COUNTRY: 'Federal', STATE: 'State', LGA: 'LGA', WARD: 'Ward', FACILITY: 'Facility' };
const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const BRAND = 'FF16543D';
const TINT = 'FFEEF6F2';
const RULE = 'FFDCDCD4';
const FONT = 'Arial';

interface Row {
  indicator_id: string | null;
  indicator_name: string | null;
  dimension: string;
  severity: string;
  org_unit_id: string;
  level: string | null;
  path: string | null;
  period_id: string;
  title: string;
  reason: string;
  evidence: Array<{ label?: string; value?: string }> | null;
}

const clean = (name: string | null | undefined) => (name ?? '').replace(/\s+/g, ' ').trim();

function number(value: string | undefined): number | string | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : value;
}

export async function buildQualityWorkbook(): Promise<{ buffer: Buffer; filename: string; findings: number }> {
  const [rows, units, indicators, lastSync] = await Promise.all([
    query<Row>(
      `SELECT f.indicator_id, f.indicator_name, f.dimension, f.severity, f.org_unit_id, u.level, u.path,
              f.period_id, f.title, f.reason, f.evidence
         FROM quality_findings f LEFT JOIN org_units u ON u.id = f.org_unit_id
        WHERE f.status = 'OPEN'`,
    ),
    query<{ id: string; name: string; level: string }>('SELECT id, name, level FROM org_units'),
    listIndicators(true),
    lastSuccessfulSync(),
  ]);

  // DHIS2 names for the source UIDs, when an instance is connected.
  const dhis2 = new Map<string, { name: string; kind: string }>();
  if (readDhis2Config()) {
    try {
      for (const item of (await getCatalogue()).items) {
        dhis2.set(item.id, { name: item.name, kind: item.kind === 'INDICATOR' ? 'Indicator' : 'Data element' });
      }
    } catch {
      // Names are a courtesy; the UIDs are still exported.
    }
  }

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const lineage = (path: string | null) => {
    const out: Record<string, string> = { STATE: '', LGA: '', WARD: '', FACILITY: '' };
    for (const id of (path ?? '').split('/')) {
      const unit = unitById.get(id);
      if (unit && unit.level in out) out[unit.level] = clean(unit.name);
    }
    return out;
  };
  const registry = new Map(indicators.map((indicator) => [indicator.id, indicator]));
  const sourceOf = (indicatorId: string | null) => {
    const source = indicatorId ? registry.get(indicatorId)?.source : undefined;
    if (!source) return { kind: 'Not mapped', uids: '', names: '' };
    if (source.dx) {
      const found = dhis2.get(source.dx);
      return { kind: found?.kind ?? 'DHIS2 item', uids: source.dx, names: found?.name ?? source.dx };
    }
    const parts: string[] = [];
    for (const expression of [source.numeratorDx, source.denominatorDx]) {
      for (const token of (expression ?? '').split('+')) {
        const uid = token.trim().split('.')[0];
        if (uid && !parts.includes(uid)) parts.push(uid);
      }
    }
    if (parts.length === 0) return { kind: 'Not mapped', uids: '', names: '' };
    const name = (uid: string) => dhis2.get(uid)?.name ?? uid;
    return {
      kind: 'Calculated from data elements',
      uids: parts.join(' + '),
      names: parts.length > 1 ? `${name(parts[0])} ÷ ${parts.slice(1).map(name).join(' + ')}` : name(parts[0]),
    };
  };

  rows.sort(
    (a, b) =>
      clean(a.indicator_name).localeCompare(clean(b.indicator_name)) ||
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
      a.period_id.localeCompare(b.period_id),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ASPIRE-GAC';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  // Created first so it opens first; filled in once the other sheets exist.
  const summary = workbook.addWorksheet('Summary');

  const style = (sheet: ExcelJS.Worksheet, widths: number[], wrap: number[] = []) => {
    widths.forEach((width, index) => (sheet.getColumn(index + 1).width = width));
    const head = sheet.getRow(1);
    head.height = 30;
    head.eachCell((cell) => {
      cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cell.font = { name: FONT, size: 10, bold: cell.font?.bold };
        cell.alignment = { vertical: 'top', wrapText: wrap.includes(column) };
        cell.border = { bottom: { style: 'thin', color: { argb: RULE } } };
      });
    });
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  };

  // ── Findings ────────────────────────────────────────────────────────────
  const findings = workbook.addWorksheet('Findings');
  findings.addRow([
    'ASPIRE indicator', 'DHIS2 source UID(s)', 'Problem type', 'Severity', 'State', 'LGA', 'Ward', 'Facility',
    'Level', 'Period', 'What was found', 'Why it was flagged', 'Reported value', 'Numerator', 'Denominator', 'Other evidence',
  ]);
  const detail = rows.map((row) => {
    const place = lineage(row.path);
    const evidence = new Map((row.evidence ?? []).map((item) => [item.label ?? '', item.value ?? '']));
    const rest = [...evidence]
      .filter(([label]) => !['Reported value', 'Numerator', 'Denominator'].includes(label))
      .map(([label, value]) => `${label}: ${value}`)
      .join('; ');
    const record = {
      indicator: clean(row.indicator_name),
      type: TYPES[row.dimension]?.label ?? row.dimension,
      severity: SEVERITY[row.severity] ?? row.severity,
      state: place.STATE,
      lga: place.LGA,
    };
    findings.addRow([
      record.indicator, sourceOf(row.indicator_id).uids, record.type, record.severity, place.STATE, place.LGA, place.WARD,
      place.FACILITY, LEVEL[row.level ?? ''] ?? row.level, row.period_id, row.title, row.reason,
      number(evidence.get('Reported value')), number(evidence.get('Numerator')), number(evidence.get('Denominator')), rest,
    ]);
    return record;
  });
  const last = detail.length + 1;
  style(findings, [34, 24, 24, 10, 16, 22, 22, 30, 10, 9, 42, 52, 12, 12, 13, 34], [11, 12, 16]);
  findings.autoFilter = { from: 'A1', to: `P${last}` };
  const range = (column: string) => `Findings!$${column}$2:$${column}$${Math.max(2, last)}`;
  const count = (predicate: (record: (typeof detail)[number]) => boolean) => detail.filter(predicate).length;

  // ── By indicator ────────────────────────────────────────────────────────
  const typeOrder = ['CONSISTENCY', 'REPEATED_VALUE', 'VALIDITY', 'STATISTICAL', 'TEMPORAL', 'COMPLETENESS', 'TIMELINESS']
    .filter((key) => rows.some((row) => row.dimension === key))
    .map((key) => TYPES[key].label);
  const byIndicator = workbook.addWorksheet('By indicator');
  byIndicator.addRow(['ASPIRE indicator', 'DHIS2 source', 'DHIS2 UID(s)', 'DHIS2 name(s)', 'Open findings', 'High severity', ...typeOrder, 'Areas affected', 'Periods affected']);
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(clean(row.indicator_name), [...(groups.get(clean(row.indicator_name)) ?? []), row]);
  const ranked = [...groups].sort((a, b) => b[1].length - a[1].length);
  ranked.forEach(([name, items], index) => {
    const r = index + 2;
    const source = sourceOf(items[0].indicator_id);
    const periods = [...new Set(items.map((item) => item.period_id))].sort();
    byIndicator.addRow([
      name, source.kind, source.uids, source.names,
      { formula: `COUNTIF(${range('A')},A${r})`, result: count((d) => d.indicator === name) },
      { formula: `COUNTIFS(${range('A')},A${r},${range('D')},"High")`, result: count((d) => d.indicator === name && d.severity === 'High') },
      ...typeOrder.map((label) => ({
        formula: `COUNTIFS(${range('A')},A${r},${range('C')},"${label}")`,
        result: count((d) => d.indicator === name && d.type === label),
      })),
      new Set(items.map((item) => item.org_unit_id)).size,
      periods.length > 1 ? `${periods[0]} to ${periods[periods.length - 1]}` : periods[0],
    ]);
  });
  style(byIndicator, [34, 18, 26, 44, 11, 11, ...typeOrder.map(() => 13), 11, 16], [1, 3, 4]);
  byIndicator.autoFilter = { from: 'A1', to: { row: ranked.length + 1, column: 8 + typeOrder.length } };

  // ── By area ─────────────────────────────────────────────────────────────
  const byArea = workbook.addWorksheet('By area');
  byArea.addRow(['State', 'LGA', 'Open findings', 'High severity', 'Most common problem']);
  const lgas = new Map<string, { state: string; lga: string; types: Map<string, number> }>();
  for (const record of detail) {
    if (!record.lga) continue;
    const key = `${record.state}|${record.lga}`;
    const entry = lgas.get(key) ?? { state: record.state, lga: record.lga, types: new Map() };
    entry.types.set(record.type, (entry.types.get(record.type) ?? 0) + 1);
    lgas.set(key, entry);
  }
  const lgaRows = [...lgas.values()].sort(
    (a, b) => [...b.types.values()].reduce((x, y) => x + y, 0) - [...a.types.values()].reduce((x, y) => x + y, 0),
  );
  lgaRows.forEach((entry, index) => {
    const r = index + 2;
    byArea.addRow([
      entry.state, entry.lga,
      { formula: `COUNTIFS(${range('E')},A${r},${range('F')},B${r})`, result: count((d) => d.state === entry.state && d.lga === entry.lga) },
      { formula: `COUNTIFS(${range('E')},A${r},${range('F')},B${r},${range('D')},"High")`, result: count((d) => d.state === entry.state && d.lga === entry.lga && d.severity === 'High') },
      [...entry.types].sort((a, b) => b[1] - a[1])[0][0],
    ]);
  });
  style(byArea, [16, 28, 14, 14, 30]);
  byArea.views = [{ state: 'frozen', ySplit: 1 }];
  byArea.autoFilter = { from: 'A1', to: `E${lgaRows.length + 1}` };
  const stateStart = lgaRows.length + 3;
  byArea.getCell(`A${stateStart}`).value = 'By state';
  byArea.getCell(`A${stateStart}`).font = { name: FONT, bold: true, size: 11 };
  [...new Set(detail.map((d) => d.state).filter(Boolean))].sort().forEach((state, index) => {
    const r = stateStart + 1 + index;
    byArea.getCell(`A${r}`).value = state;
    byArea.getCell(`C${r}`).value = { formula: `COUNTIF(${range('E')},A${r})`, result: count((d) => d.state === state) };
    byArea.getCell(`D${r}`).value = { formula: `COUNTIFS(${range('E')},A${r},${range('D')},"High")`, result: count((d) => d.state === state && d.severity === 'High') };
    for (const column of ['A', 'C', 'D']) byArea.getCell(`${column}${r}`).font = { name: FONT, size: 10 };
  });

  // ── Problem types ───────────────────────────────────────────────────────
  const types = workbook.addWorksheet('Problem types');
  types.addRow(['Problem type', 'What it means', 'What to check in DHIS2']);
  for (const key of Object.keys(TYPES)) {
    if (rows.some((row) => row.dimension === key)) types.addRow([TYPES[key].label, TYPES[key].meaning, TYPES[key].action]);
  }
  style(types, [28, 60, 64], [2, 3]);

  // ── Summary ─────────────────────────────────────────────────────────────
  [46, 16, 16, 60].forEach((width, index) => (summary.getColumn(index + 1).width = width));
  const text = (cell: string, value: string, font: Partial<ExcelJS.Font> = {}) => {
    summary.getCell(cell).value = value;
    summary.getCell(cell).font = { name: FONT, size: 10, ...font };
  };
  text('A1', 'ASPIRE-GAC: open data quality issues', { bold: true, size: 15 });
  const source = readDhis2Config()?.baseUrl.replace(/^https?:\/\//, '') ?? 'demo data';
  const asOf = lastSync?.finishedAt ? new Date(lastSync.finishedAt).toUTCString().replace('GMT', 'UTC') : 'unknown';
  text('A2', `Source: ASPIRE, reading ${source}. Findings as of the synchronisation on ${asOf}. Only open findings are included. Exported ${new Date().toUTCString().replace('GMT', 'UTC')}.`, { color: { argb: 'FF55554F' } });
  summary.mergeCells('A2:D2');
  summary.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  summary.getRow(2).height = 42;

  const put = (r: number, label: string, formula: string, result: number) => {
    text(`A${r}`, label, { size: 11 });
    summary.getCell(`B${r}`).value = { formula, result };
    summary.getCell(`B${r}`).font = { name: FONT, size: 11, bold: true };
    summary.getCell(`B${r}`).numFmt = '#,##0';
  };
  put(4, 'Open findings', `COUNTA(${range('A')})`, detail.length);
  put(5, 'Indicators affected', `COUNTA('By indicator'!A2:A${ranked.length + 1})`, ranked.length);
  put(6, 'LGAs affected', `COUNTA('By area'!B2:B${lgaRows.length + 1})`, lgaRows.length);

  const table = (start: number, title: string, labels: string[], column: string) => {
    ['A', 'B', 'C'].forEach((col, index) => {
      const cell = summary.getCell(`${col}${start}`);
      cell.value = [title, 'Findings', 'Share'][index];
      cell.font = { name: FONT, bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT } };
    });
    labels.forEach((label, index) => {
      const r = start + 1 + index;
      const n = count((d) => (column === 'C' ? d.type : d.severity) === label);
      text(`A${r}`, label);
      summary.getCell(`B${r}`).value = { formula: `COUNTIF(${range(column)},A${r})`, result: n };
      summary.getCell(`B${r}`).numFmt = '#,##0';
      summary.getCell(`C${r}`).value = { formula: `IF($B$4=0,0,B${r}/$B$4)`, result: detail.length ? n / detail.length : 0 };
      summary.getCell(`C${r}`).numFmt = '0%';
      for (const col of ['B', 'C']) summary.getCell(`${col}${r}`).font = { name: FONT, size: 10 };
    });
    return start + labels.length + 2;
  };
  const presentTypes = typeOrder.sort((a, b) => count((d) => d.type === b) - count((d) => d.type === a));
  let next = table(8, 'By problem type', presentTypes, 'C');
  next = table(next, 'By severity', ['High', 'Medium', 'Low'], 'D');

  const notes = [
    'How to use this workbook',
    '• By indicator: which ASPIRE indicators have the most issues, and the DHIS2 indicator or data element each is read from (UID and name), so the DHIS2 team can find it.',
    '• By area: the LGAs with the most issues, busiest first. Filter the Findings sheet by LGA to see the detail.',
    '• Findings: one row per issue, with the state, LGA, ward and facility, the period, and the figures behind it. Use the filter arrows to narrow it down.',
    '• Problem types: what each type means and what to check in DHIS2.',
    '• Counts on this sheet and on By indicator and By area are formulas over the Findings sheet.',
  ];
  notes.forEach((note, index) => {
    const r = next + 1 + index;
    text(`A${r}`, note, { bold: index === 0 });
    summary.mergeCells(`A${r}:D${r}`);
    summary.getCell(`A${r}`).alignment = { wrapText: true, vertical: 'top' };
    summary.getRow(r).height = index === 0 ? 16 : 30;
  });

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const date = new Date().toISOString().slice(0, 10);
  return { buffer, filename: `ASPIRE_Data_Quality_Issues_${date}.xlsx`, findings: detail.length };
}
