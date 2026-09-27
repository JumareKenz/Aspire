'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReconciliationResult } from '@/services/reconciliation';
import type { OutlierRow, RuleViolation } from '@/services/validation';
import type { Catalogue, CatalogueItem, TreeNode } from '@/services/explorer';
import { Badge } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Card } from '@/design/primitives/Card';
import { Select, TextInput } from '@/design/primitives/Field';
import { EmptyState, ErrorState } from '@/design/primitives/States';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { callApi, saveText, toCsv } from '../explorer/api';
import { Chip, FieldGroup, ScrollArea } from '../ui';
import { periodLabel, recentPeriods } from '../explorer/periods';

const fmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const LEVEL: Record<string, string> = { COUNTRY: 'Federal', STATE: 'State', LGA: 'LGA', WARD: 'Ward', FACILITY: 'Facility' };
const PAGE = 50;

function NotConnected() {
  return (
    <Card className="p-4">
      <EmptyState title="No DHIS2 instance is connected." description="DHIS2 checks need a connected instance." />
    </Card>
  );
}

/* ── Reconciliation ─────────────────────────────────────────────────────── */

export function ReconciliationPanel({ initial, canRun }: { initial: ReconciliationResult | null; canRun: boolean }) {
  const [result, setResult] = useState(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<'compared' | 'differences' | 'empty'>('compared');
  const [level, setLevel] = useState('');
  const [indicator, setIndicator] = useState('');
  const [visible, setVisible] = useState(PAGE);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await callApi<ReconciliationResult>('/api/admin/validation/reconcile', { method: 'POST' }));
      setVisible(PAGE);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The check did not run.');
    } finally {
      setRunning(false);
    }
  }

  const rows = useMemo(
    () =>
      (result?.comparisons ?? []).filter(
        (row) =>
          (show === 'compared'
            ? row.result !== 'BOTH_EMPTY'
            : show === 'differences'
              ? row.result !== 'MATCH' && row.result !== 'BOTH_EMPTY'
              : row.result === 'BOTH_EMPTY') &&
          (!level || row.level === level) &&
          (!indicator || row.indicatorId === indicator),
      ),
    [result, show, level, indicator],
  );
  const indicators = useMemo(
    () => [...new Map((result?.comparisons ?? []).map((row) => [row.indicatorId, row.indicatorName])).entries()],
    [result],
  );

  const s = result?.summary;
  const differences = s ? s.mismatched + s.onlyAspire + s.onlyDhis2 : 0;

  return (
    <Card className="flex flex-col gap-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          {s ? (
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-[28px] font-semibold leading-none tracking-[-0.02em]">
                  {s.matched.toLocaleString('en-GB')}
                  <span className="text-[var(--text-tertiary)]"> / {s.compared.toLocaleString('en-GB')}</span>
                </p>
                <p className="text-[14px] text-[var(--text-secondary)]">values identical to DHIS2</p>
                <Badge tone={differences === 0 ? 'positive' : 'concern'}>
                  {differences === 0 ? 'No differences' : `${differences} differences`}
                </Badge>
              </div>
              <div className="h-2 max-w-xl overflow-hidden rounded-full bg-[var(--ink-100)]" aria-hidden="true">
                <div
                  className={differences === 0 ? 'h-full rounded-full bg-[var(--status-fill-positive)]' : 'h-full rounded-full bg-[var(--status-fill-warning)]'}
                  style={{ width: `${s.compared === 0 ? 0 : (s.matched / s.compared) * 100}%` }}
                />
              </div>
              <span className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                {s.indicators} indicators · {s.orgUnits} areas · {result!.periods.map(periodLabel).join(' and ')} · largest difference{' '}
                {s.maxDifference < 0.000001 ? 'under 0.000001' : fmt.format(s.maxDifference)} · checked{' '}
                {new Date(result!.reconciledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--text-secondary)]">No reconciliation has been run yet.</p>
          )}
          {canRun ? (
            <Button variant="primary" onClick={run} disabled={running}>
              {running ? 'Checking against DHIS2…' : 'Run check now'}
            </Button>
          ) : null}
        </div>
        {error ? <ErrorState title="The check did not run." description={error} /> : null}

        {result ? (
          <>
            <div className="flex flex-wrap items-end gap-3 border-t pt-6">
              <Select label="Show" value={show} onChange={(event) => { setShow(event.target.value as typeof show); setVisible(PAGE); }} className="w-[200px]">
                <option value="compared">Values compared</option>
                <option value="differences">Differences only</option>
                <option value="empty">No value on either side</option>
              </Select>
              <Select label="Level" value={level} onChange={(event) => { setLevel(event.target.value); setVisible(PAGE); }} className="w-[150px]">
                <option value="">All levels</option>
                {['COUNTRY', 'STATE', 'LGA', 'WARD', 'FACILITY'].map((value) => (
                  <option key={value} value={value}>{LEVEL[value]}</option>
                ))}
              </Select>
              <Select label="Indicator" value={indicator} onChange={(event) => { setIndicator(event.target.value); setVisible(PAGE); }} className="w-[280px]">
                <option value="">All indicators</option>
                {indicators.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </Select>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() =>
                  saveText(
                    'aspire-reconciliation.csv',
                    toCsv([
                      ['Indicator', 'Area', 'Level', 'Quarter', 'Method', 'ASPIRE', 'DHIS2', 'Result'],
                      ...result.comparisons.map((row) => [row.indicatorName, row.orgUnitName, LEVEL[row.level], row.periodId, row.method, row.aspire, row.dhis2, row.result]),
                    ]),
                  )
                }
              >
                Download all (CSV)
              </Button>
            </div>
            {rows.length === 0 ? (
              <EmptyState title={show === 'differences' ? 'No differences. Every compared value matches DHIS2.' : 'Nothing matches these filters.'} />
            ) : (
              <>
                <ScrollArea>
              <TableWrap>
                  <thead>
                    <tr>
                      <Th>Indicator</Th>
                      <Th>Area</Th>
                      <Th>Quarter</Th>
                      <Th>How DHIS2&rsquo;s figure was taken</Th>
                      <Th align="right">ASPIRE</Th>
                      <Th align="right">DHIS2</Th>
                      <Th>Result</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, visible).map((row) => (
                      <Tr key={`${row.indicatorId}|${row.orgUnitId}|${row.periodId}`}>
                        <Td className="text-[12px]">{row.indicatorName}</Td>
                        <Td className="text-[12px]">
                          {row.orgUnitName.replace(' Local Government Area', '')}
                          <span className="ml-1.5 text-[11px] text-[var(--text-tertiary)]">{LEVEL[row.level]}</span>
                        </Td>
                        <Td className="text-[12px]">{periodLabel(row.periodId)}</Td>
                        <Td className="text-[12px] text-[var(--text-tertiary)]">{row.method}</Td>
                        <Td align="right" numeric className="text-[12px]">{row.aspire === null ? '–' : fmt.format(row.aspire)}</Td>
                        <Td align="right" numeric className="text-[12px]">{row.dhis2 === null ? '–' : fmt.format(row.dhis2)}</Td>
                        <Td>
                          <Badge tone={row.result === 'MATCH' ? 'positive' : row.result === 'BOTH_EMPTY' ? 'neutral' : 'concern'}>
                            {row.result === 'MATCH' ? 'Identical' : row.result === 'BOTH_EMPTY' ? 'No value either side' : row.result === 'MISMATCH' ? 'Different' : row.result === 'ONLY_DHIS2' ? 'Missing in ASPIRE' : 'Missing in DHIS2'}
                          </Badge>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableWrap>
              </ScrollArea>
                {rows.length > visible ? (
                  <div className="flex justify-center">
                    <Button size="sm" onClick={() => setVisible((count) => count + PAGE)}>
                      Show more ({rows.length - visible} left)
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : null}
    </Card>
  );
}

/* ── Outlier detection ──────────────────────────────────────────────────── */

/** A local calendar date as YYYY-MM-DD (toISOString would shift it to UTC). */
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The last month of a period id such as 2025Q4 or 202510, as YYYYMM. */
function lastMonthOf(periodId: string): string {
  const quarter = /^(\d{4})Q([1-4])$/.exec(periodId);
  if (quarter) return `${quarter[1]}${String(Number(quarter[2]) * 3).padStart(2, '0')}`;
  return periodId;
}

export function OutlierPanel({
  areas,
  connected,
  defaultPeriod,
}: {
  areas: Array<{ id: string; name: string; group: string }>;
  connected: boolean;
  /** The platform's default period; the range defaults to the year ending with it. */
  defaultPeriod: string;
}) {
  const [catalogue, setCatalogue] = useState<CatalogueItem[] | null>(null);
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<CatalogueItem[]>([]);
  const [area, setArea] = useState(areas[0]?.id ?? '');
  const [start, setStart] = useState(() => {
    const month = lastMonthOf(defaultPeriod);
    return isoDate(new Date(Number(month.slice(0, 4)) - 1, Number(month.slice(4)), 1));
  });
  const [end, setEnd] = useState(() => {
    const month = lastMonthOf(defaultPeriod);
    return isoDate(new Date(Number(month.slice(0, 4)), Number(month.slice(4)), 0));
  });
  const [algorithm, setAlgorithm] = useState<'MOD_Z_SCORE' | 'Z_SCORE' | 'MIN_MAX'>('MOD_Z_SCORE');
  const [threshold, setThreshold] = useState('3');
  const [rows, setRows] = useState<OutlierRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadCatalogue() {
    if (catalogue !== null) return;
    callApi<Catalogue>('/api/admin/explorer/catalogue')
      .then((value) => setCatalogue(value.items.filter((item) => item.kind === 'DATA_ELEMENT')))
      .catch(() => setCatalogue([]));
  }

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!catalogue || needle.length < 2) return [];
    return catalogue.filter((item) => item.name.toLowerCase().includes(needle) || item.id.toLowerCase() === needle).slice(0, 12);
  }, [catalogue, text]);

  if (!connected) return <NotConnected />;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const result = await callApi<{ rows: OutlierRow[]; truncated: boolean }>('/api/admin/validation/outliers', {
        method: 'POST',
        body: JSON.stringify({
          dataElements: chosen.map((item) => item.id),
          orgUnit: area,
          startDate: start,
          endDate: end,
          algorithm,
          threshold: algorithm === 'MIN_MAX' ? null : Number(threshold) || null,
        }),
      });
      setRows(result.rows);
      setTruncated(result.truncated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The check did not run.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="flex flex-col gap-6 p-5 sm:p-7">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
          <FieldGroup title="What to check">
            <TextInput
              label="Data elements"
              placeholder="Search, e.g. New FP Acceptors or Deliveries"
              value={text}
              onFocus={loadCatalogue}
              onChange={(event) => setText(event.target.value)}
            />
            {matches.length > 0 ? (
              <ul className="max-h-[220px] overflow-y-auto rounded-[var(--radius-lg)] border shadow-[var(--shadow-sm)]">
                {matches.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-[var(--surface-sunken)]"
                      onClick={() => {
                        setChosen((list) => (list.some((entry) => entry.id === item.id) || list.length >= 20 ? list : [...list, item]));
                        setText('');
                      }}
                    >
                      <span>{item.name}</span>
                      {item.usedBy ? <Badge tone="brand">ASPIRE</Badge> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {chosen.map((item) => (
                <Chip key={item.id} onRemove={() => setChosen((list) => list.filter((entry) => entry.id !== item.id))}>
                  {item.name}
                </Chip>
              ))}
              {chosen.length === 0 ? <span className="text-[12px] text-[var(--text-tertiary)]">Choose up to 20 data elements.</span> : null}
            </div>
          </FieldGroup>
          <FieldGroup title="Where and when">
            <Select label="LGA" value={area} onChange={(event) => setArea(event.target.value)}>
              {[...new Set(areas.map((unit) => unit.group))].map((group) => (
                <optgroup key={group} label={group}>
                  {areas
                    .filter((unit) => unit.group === group)
                    .map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <TextInput label="From" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
              <TextInput label="To" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
            </div>
          </FieldGroup>
          <FieldGroup title="How strict">
            <Select label="Method" value={algorithm} onChange={(event) => setAlgorithm(event.target.value as typeof algorithm)}>
              <option value="MOD_Z_SCORE">Modified z-score (robust)</option>
              <option value="Z_SCORE">Z-score</option>
              <option value="MIN_MAX">Outside min–max limits</option>
            </Select>
            <TextInput label="Threshold" type="number" min={1} max={10} step={0.5} value={threshold} disabled={algorithm === 'MIN_MAX'} onChange={(event) => setThreshold(event.target.value)} />
          </FieldGroup>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <p className="text-[12px] text-[var(--text-tertiary)]">
            A modified z-score of 3 or more marks a value far from that facility&rsquo;s usual reporting.
          </p>
          <Button variant="primary" onClick={run} disabled={running || chosen.length === 0 || !area}>
            {running ? 'Checking…' : 'Find outliers'}
          </Button>
        </div>
        {error ? <ErrorState title="The check did not run." description={error} /> : null}
        {rows ? (
          rows.length === 0 ? (
            <EmptyState title="No outliers found." description="Every facility-month in this range sits within the threshold." />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[var(--text-secondary)]">
                  {rows.length.toLocaleString('en-GB')} outliers{truncated ? ' (the first 500, most extreme first)' : ', most extreme first'}
                </p>
                <Button
                  size="sm"
                  onClick={() =>
                    saveText(
                      'dhis2-outliers.csv',
                      toCsv([
                        ['Facility', 'Data element', 'Category', 'Month', 'Value', 'Median', 'Lower bound', 'Upper bound', 'Z-score'],
                        ...rows.map((row) => [row.facility, row.dataElement, row.category, row.period, row.value, row.median, row.lower, row.upper, row.zScore]),
                      ]),
                    )
                  }
                >
                  Download (CSV)
                </Button>
              </div>
              <ScrollArea>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Facility</Th>
                    <Th>Data element</Th>
                    <Th>Month</Th>
                    <Th align="right">Value</Th>
                    <Th align="right">Usual (median)</Th>
                    <Th align="right">Expected range</Th>
                    <Th align="right">Z-score</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((row, index) => (
                    <Tr key={`${row.facility}|${row.dataElement}|${row.period}|${row.category}|${index}`}>
                      <Td className="text-[12px]">{row.facility}</Td>
                      <Td className="text-[12px]">
                        {row.dataElement}
                        {row.category ? <span className="ml-1.5 text-[11px] text-[var(--text-tertiary)]">{row.category}</span> : null}
                      </Td>
                      <Td className="text-[12px]">{periodLabel(row.period)}</Td>
                      <Td align="right" numeric className="text-[12px] font-semibold">{fmt.format(row.value)}</Td>
                      <Td align="right" numeric className="text-[12px]">{row.median === null ? '–' : fmt.format(row.median)}</Td>
                      <Td align="right" numeric className="text-[12px] text-[var(--text-tertiary)]">
                        {row.lower === null || row.upper === null ? '–' : `${fmt.format(Math.max(0, row.lower))} – ${fmt.format(row.upper)}`}
                      </Td>
                      <Td align="right">
                        {row.zScore === null ? '–' : (
                          <Badge tone={row.zScore >= 10 ? 'concern' : row.zScore >= 5 ? 'warning' : 'neutral'}>{fmt.format(row.zScore)}</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
              </ScrollArea>
              {rows.length > 200 ? <p className="text-[12px] text-[var(--text-tertiary)]">Showing 200 here; the download has all {rows.length}.</p> : null}
            </>
          )
        ) : null}
    </Card>
  );
}

/* ── Validation rules ───────────────────────────────────────────────────── */

const OPERATOR: Record<string, string> = {
  equal_to: '=',
  not_equal_to: '≠',
  greater_than: '>',
  greater_than_or_equal_to: '≥',
  less_than: '<',
  less_than_or_equal_to: '≤',
  compulsory_pair: 'both or neither',
  exclusive_pair: 'not both',
};

export function RuleCheckPanel({ connected, defaultPeriod }: { connected: boolean; defaultPeriod: string }) {
  const [forms, setForms] = useState<Array<{ id: string; name: string }> | null>(null);
  const [form, setForm] = useState('');
  const [text, setText] = useState('');
  const [found, setFound] = useState<Array<TreeNode & { parentName: string | null }>>([]);
  const [unit, setUnit] = useState<{ id: string; name: string } | null>(null);
  const months = useMemo(() => recentPeriods('MONTHLY').slice(0, 24), []);
  const [period, setPeriod] = useState(() => {
    const month = lastMonthOf(defaultPeriod);
    return months.some((option) => option.id === month) ? month : (months[1]?.id ?? '');
  });
  const [result, setResult] = useState<{ violations: RuleViolation[]; unit: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    callApi<Array<{ id: string; name: string }>>('/api/admin/validation/rules')
      .then((list) => {
        setForms(list);
        setForm((current) => current || (list.find((entry) => /NHMIS/i.test(entry.name))?.id ?? list[0]?.id ?? ''));
      })
      .catch((reason: Error) => setError(reason.message));
  }, [connected]);

  const needle = text.trim();
  useEffect(() => {
    if (needle.length < 2) return;
    const timer = setTimeout(() => {
      callApi<Array<TreeNode & { parentName: string | null }>>(`/api/admin/explorer/orgunits?q=${encodeURIComponent(needle)}`)
        .then(setFound)
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [needle]);

  if (!connected) return <NotConnected />;

  async function run() {
    if (!unit) return;
    setRunning(true);
    setError(null);
    try {
      setResult(
        await callApi<{ violations: RuleViolation[]; unit: string }>('/api/admin/validation/rules', {
          method: 'POST',
          body: JSON.stringify({ dataSet: form, orgUnit: unit.id, period }),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The check did not run.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="flex flex-col gap-6 p-5 sm:p-7">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_200px]">
          <Select label="Form" value={form} onChange={(event) => setForm(event.target.value)} disabled={!forms}>
            {forms === null ? <option>Loading forms…</option> : null}
            {(forms ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </Select>
          <div className="relative flex flex-col gap-1">
            <TextInput
              label="Area"
              placeholder="Search a facility, ward or LGA"
              value={unit && text === '' ? unit.name : text}
              onChange={(event) => {
                setUnit(null);
                setText(event.target.value);
              }}
            />
            {needle.length >= 2 && !unit && found.length > 0 ? (
              <ul className="absolute top-full z-10 mt-1 max-h-[220px] w-full overflow-y-auto rounded-[var(--radius-md)] border bg-[var(--surface-raised)] shadow-[var(--shadow-md)]">
                {found.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 border-b px-2.5 py-1.5 text-left text-[12px] last:border-b-0 hover:bg-[var(--surface-sunken)]"
                      onClick={() => {
                        setUnit({ id: entry.id, name: entry.name });
                        setText('');
                      }}
                    >
                      <span>{entry.name}</span>
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        {LEVEL[entry.level]}{entry.parentName ? ` · ${entry.parentName}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Select label="Month" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {months.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Rules are checked for one area and month at a time. The NHMIS 2019 and 2025 forms are not shared with this account, so their rules cannot run yet.
          </p>
          <Button variant="primary" onClick={run} disabled={running || !unit || !form || !period}>
            {running ? 'Validating…' : 'Run validation rules'}
          </Button>
        </div>
        {error ? <ErrorState title="The check did not run." description={error} /> : null}
        {result ? (
          result.violations.length === 0 ? (
            <EmptyState title={`No rule violations for ${result.unit} in ${periodLabel(period)}.`} description="Either every rule passed, or the form has no data for this area and month." />
          ) : (
            <>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {result.violations.length} {result.violations.length === 1 ? 'rule' : 'rules'} broken for {result.unit} in {periodLabel(period)}
              </p>
              <ScrollArea>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Rule</Th>
                    <Th>Importance</Th>
                    <Th>Left side</Th>
                    <Th align="center">Should be</Th>
                    <Th>Right side</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.violations.map((violation, index) => (
                    <Tr key={`${violation.rule}|${index}`}>
                      <Td className="text-[12px]">
                        {violation.rule}
                        {violation.instruction ? <span className="mt-0.5 block text-[11px] text-[var(--text-tertiary)]">{violation.instruction}</span> : null}
                      </Td>
                      <Td>
                        <Badge tone={violation.importance === 'HIGH' ? 'concern' : violation.importance === 'MEDIUM' ? 'warning' : 'neutral'}>
                          {(violation.importance ?? 'unrated').toLowerCase()}
                        </Badge>
                      </Td>
                      <Td className="text-[12px]">
                        <span className="numeric font-semibold">{violation.left.value === null ? '–' : fmt.format(violation.left.value)}</span>
                        <span className="block text-[11px] text-[var(--text-tertiary)]">{violation.left.description ?? ''}</span>
                      </Td>
                      <Td align="center" className="text-[13px] font-semibold">{OPERATOR[violation.operator ?? ''] ?? violation.operator ?? '?'}</Td>
                      <Td className="text-[12px]">
                        <span className="numeric font-semibold">{violation.right.value === null ? '–' : fmt.format(violation.right.value)}</span>
                        <span className="block text-[11px] text-[var(--text-tertiary)]">{violation.right.description ?? ''}</span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
              </ScrollArea>
            </>
          )
        ) : null}
    </Card>
  );
}
