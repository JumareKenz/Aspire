'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Catalogue, CatalogueItem, ExplorerResult } from '@/services/explorer';
import { Badge } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { Select } from '@/design/primitives/Field';
import { EmptyState, ErrorState, LoadingBlock } from '@/design/primitives/States';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { LineChart } from '@/design/charts/LineChart';
import { cn } from '@/design/primitives/cn';
import { callApi, saveText, toCsv } from './api';
import { DataPicker } from './DataPicker';
import { OrgUnitPicker, type PickedUnit } from './OrgUnitPicker';
import { RELATIVE, periodLabel, recentPeriods, type PeriodType } from './periods';

type Level = 'STATE' | 'LGA' | 'WARD' | 'FACILITY';
type Across = 'pe' | 'ou' | 'dx';

const fmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

/**
 * Ad-hoc analysis against the connected DHIS2 instance: choose data, periods
 * and areas, then read the answer as a table or chart and take it away as CSV.
 * The query runs on the server (see /api/admin/explorer/query); this component
 * only builds it and lays out the answer.
 */
export function Explorer({ source }: { source: string }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [data, setData] = useState<CatalogueItem[]>([]);
  const [periodType, setPeriodType] = useState<PeriodType>('QUARTERLY');
  const [periods, setPeriods] = useState<string[]>([]);
  const [units, setUnits] = useState<PickedUnit[]>([]);
  const [level, setLevel] = useState<Level | ''>('');
  const [category, setCategory] = useState('');
  const [result, setResult] = useState<ExplorerResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [across, setAcross] = useState<Across>('pe');

  function loadCatalogue(refresh = false) {
    setCatalogueError(null);
    callApi<Catalogue>(`/api/admin/explorer/catalogue${refresh ? '?refresh=1' : ''}`)
      .then(setCatalogue)
      .catch((reason: Error) => setCatalogueError(reason.message));
  }
  useEffect(() => {
    callApi<Catalogue>('/api/admin/explorer/catalogue')
      .then(setCatalogue)
      .catch((reason: Error) => setCatalogueError(reason.message));
  }, []);

  const toggle = <T extends { id: string }>(list: T[], item: T) =>
    list.some((entry) => entry.id === item.id) ? list.filter((entry) => entry.id !== item.id) : [...list, item];

  // A split by category needs exactly one data element that has categories;
  // a choice that no longer applies is simply not used.
  const splittable = data.length === 1 && data[0].kind === 'DATA_ELEMENT' ? data[0].categories : [];
  const split = splittable.some((option) => option.id === category) ? category : '';

  const ready = data.length > 0 && periods.length > 0 && units.length > 0;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const next = await callApi<ExplorerResult>('/api/admin/explorer/query', {
        method: 'POST',
        body: JSON.stringify({
          dx: data.map((item) => item.id),
          periods,
          orgUnits: units.map((unit) => unit.id),
          level: level || null,
          category: split || null,
        }),
      });
      setResult(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The query failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="1 · Data" description="Indicators or data elements from the connected instance." />
          <CardBody>
            {catalogueError ? (
              <ErrorState title="The DHIS2 catalogue could not be loaded." description={catalogueError} />
            ) : catalogue ? (
              <DataPicker items={catalogue.items} selected={data} onToggle={(item) => setData((list) => toggle(list, item))} />
            ) : (
              <LoadingBlock rows={4} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2 · Periods" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {RELATIVE.map((option) => (
                <Chip key={option.id} on={periods.includes(option.id)} onClick={() => setPeriods((list) => flip(list, option.id))}>
                  {option.label}
                </Chip>
              ))}
            </div>
            <Select label="Period type" value={periodType} onChange={(event) => setPeriodType(event.target.value as PeriodType)}>
              <option value="MONTHLY">Months</option>
              <option value="QUARTERLY">Quarters</option>
              <option value="YEARLY">Years</option>
            </Select>
            <div className="grid max-h-[180px] grid-cols-3 gap-1.5 overflow-y-auto">
              {recentPeriods(periodType).map((option) => (
                <Chip key={option.id} on={periods.includes(option.id)} onClick={() => setPeriods((list) => flip(list, option.id))}>
                  {option.label}
                </Chip>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="3 · Areas" description="Areas in your access. Federal figures are the two states combined." />
          <CardBody className="flex flex-col gap-3">
            <OrgUnitPicker selected={units} onToggle={(unit) => setUnits((list) => toggle(list, unit))} />
            <Select label="Show values for" value={level} onChange={(event) => setLevel(event.target.value as Level | '')}>
              <option value="">The selected areas</option>
              <option value="STATE">Each state within them</option>
              <option value="LGA">Each LGA within them</option>
              <option value="WARD">Each ward within them</option>
              <option value="FACILITY">Each facility within them</option>
            </Select>
          </CardBody>
        </Card>

        {splittable.length > 0 ? (
          <Card>
            <CardHeader title="4 · Split" description="Break the data element down by one of its categories." />
            <CardBody>
              <Select label="Split by" value={split} onChange={(event) => setCategory(event.target.value)}>
                <option value="">No split (totals)</option>
                {splittable.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col gap-3">
            <Selection data={data} periods={periods} units={units} onRemoveData={(id) => setData((list) => list.filter((item) => item.id !== id))} onRemovePeriod={(id) => setPeriods((list) => list.filter((entry) => entry !== id))} onRemoveUnit={(id) => setUnits((list) => list.filter((unit) => unit.id !== id))} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-[12px] text-[var(--text-tertiary)]">
                Source <span className="font-mono">{source.replace(/^https?:\/\//, '')}</span>
                {catalogue ? (
                  <>
                    {' '}· catalogue loaded {new Date(catalogue.loadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}{' '}
                    <button type="button" className="text-[var(--brand-600)] hover:underline" onClick={() => loadCatalogue(true)}>
                      Reload
                    </button>
                  </>
                ) : null}
              </p>
              <Button variant="primary" onClick={run} disabled={!ready || running}>
                {running ? 'Running…' : 'Run query'}
              </Button>
            </div>
          </CardBody>
        </Card>

        {error ? <ErrorState title="The query did not run." description={error} /> : null}

        {result ? (
          <Results result={result} view={view} setView={setView} across={across} setAcross={setAcross} />
        ) : !error ? (
          <Card className="p-4">
            <EmptyState
              title="Choose data, periods and areas, then run the query."
              description="For example: “Deliveries with a skilled birth attendant” for the last 4 quarters in both states, shown for each LGA."
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function flip(list: string[], id: string) {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius-md)] border px-2 py-1 text-[12px] transition-colors',
        on
          ? 'border-[var(--brand-600)] bg-[var(--brand-050)] font-medium text-[var(--brand-700)]'
          : 'text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
      )}
    >
      {children}
    </button>
  );
}

function Selection({
  data,
  periods,
  units,
  onRemoveData,
  onRemovePeriod,
  onRemoveUnit,
}: {
  data: CatalogueItem[];
  periods: string[];
  units: PickedUnit[];
  onRemoveData: (id: string) => void;
  onRemovePeriod: (id: string) => void;
  onRemoveUnit: (id: string) => void;
}) {
  const group = (label: string, items: Array<{ id: string; label: string }>, remove: (id: string) => void) => (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2">
      <span className="pt-1 text-[11px] font-medium text-[var(--text-tertiary)]">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="pt-1 text-[12px] text-[var(--text-tertiary)]">None chosen</span>
        ) : (
          items.map((item) => (
            <span key={item.id} className="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-md)] border bg-[var(--surface-sunken)] py-0.5 pl-2 pr-1 text-[12px]">
              <span className="truncate">{item.label}</span>
              <button type="button" aria-label={`Remove ${item.label}`} onClick={() => remove(item.id)} className="rounded px-1 text-[var(--text-tertiary)] hover:bg-[var(--ink-100)]">
                ×
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      {group('Data', data.map((item) => ({ id: item.id, label: item.name })), onRemoveData)}
      {group('Periods', periods.map((id) => ({ id, label: periodLabel(id) })), onRemovePeriod)}
      {group('Areas', units.map((unit) => ({ id: unit.id, label: unit.name })), onRemoveUnit)}
    </div>
  );
}

interface Pivot {
  columns: Array<{ id: string; name: string }>;
  rows: Array<{ key: string; label: string[]; cells: Array<number | null> }>;
  rowHeaders: string[];
  fixed: string[];
}

/** Lays the flat result out with one dimension across and the rest down the side. */
function pivot(result: ExplorerResult, across: Across): Pivot {
  const dims = result.dimensions;
  const all: Record<string, Array<{ id: string; name: string }>> = {
    dx: dims.dx,
    pe: dims.pe.map((entry) => ({ id: entry.id, name: periodLabel(entry.id) === entry.id ? entry.name : periodLabel(entry.id) })),
    ou: dims.ou,
    ...(dims.co ? { co: dims.co } : {}),
  };
  const header: Record<string, string> = { dx: 'Data', pe: 'Period', ou: 'Area', co: 'Category' };
  const down = (['dx', 'ou', 'co', 'pe'] as const).filter((dim) => dim !== across && all[dim]);
  // Dimensions with a single value go into the caption, not every row.
  const varying = down.filter((dim) => all[dim].length > 1);
  const fixed = down.filter((dim) => all[dim].length === 1).map((dim) => `${header[dim]}: ${all[dim][0].name}`);
  const rowDims = varying.length > 0 ? varying : down.slice(0, 1);

  const index = new Map<string, number>();
  for (const row of result.rows) index.set(`${row.dx}|${row.pe}|${row.ou}|${row.co ?? ''}`, row.value);

  const combos: Array<Record<string, { id: string; name: string }>> = [{}];
  for (const dim of rowDims) {
    const next: typeof combos = [];
    for (const combo of combos) for (const entry of all[dim]) next.push({ ...combo, [dim]: entry });
    combos.splice(0, combos.length, ...next);
  }
  const pick = (combo: Record<string, { id: string; name: string }>, dim: string, column: { id: string }) =>
    dim === across ? column.id : (combo[dim]?.id ?? all[dim]?.[0]?.id ?? '');

  const rows = combos
    .map((combo) => {
      const cells = all[across].map((column) => {
        const key = `${pick(combo, 'dx', column)}|${pick(combo, 'pe', column)}|${pick(combo, 'ou', column)}|${dims.co ? pick(combo, 'co', column) : ''}`;
        return index.get(key) ?? null;
      });
      return { key: rowDims.map((dim) => combo[dim].id).join('|'), label: rowDims.map((dim) => combo[dim].name), cells };
    })
    .filter((row) => row.cells.some((cell) => cell !== null));

  return { columns: all[across], rows, rowHeaders: rowDims.map((dim) => header[dim]), fixed };
}

function Results({
  result,
  view,
  setView,
  across,
  setAcross,
}: {
  result: ExplorerResult;
  view: 'table' | 'chart';
  setView: (view: 'table' | 'chart') => void;
  across: Across;
  setAcross: (across: Across) => void;
}) {
  const table = useMemo(() => pivot(result, across), [result, across]);
  const byPeriod = useMemo(() => pivot(result, 'pe'), [result]);
  const [copied, setCopied] = useState(false);

  function downloadTable() {
    saveText(
      'aspire-explorer-table.csv',
      toCsv([
        [...table.rowHeaders, ...table.columns.map((column) => column.name)],
        ...table.rows.map((row) => [...row.label, ...row.cells]),
      ]),
    );
  }
  function downloadValues() {
    const name = (list: Array<{ id: string; name: string }>, id: string | null) => list.find((entry) => entry.id === id)?.name ?? id;
    saveText(
      'aspire-explorer-values.csv',
      toCsv([
        ['Data', 'Data UID', 'Period', 'Area', 'Area UID', ...(result.dimensions.co ? ['Category'] : []), 'Value'],
        ...result.rows.map((row) => [
          name(result.dimensions.dx, row.dx),
          row.dx,
          row.pe,
          name(result.dimensions.ou, row.ou),
          row.ou,
          ...(result.dimensions.co ? [name(result.dimensions.co, row.co)] : []),
          row.value,
        ]),
      ]),
    );
  }
  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(result.dhis2Url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const chartable = byPeriod.columns.length >= 2;
  const series = byPeriod.rows.slice(0, 4);

  return (
    <Card>
      <CardHeader
        title="Result"
        description={`${result.rows.length.toLocaleString('en-GB')} values from DHIS2 in ${(result.durationMs / 1000).toFixed(1)} s`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="View" className="flex rounded-[var(--radius-md)] border p-0.5">
              {(['table', 'chart'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  onClick={() => setView(value)}
                  className={cn(
                    'rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 text-[12px] font-medium',
                    view === value ? 'bg-[var(--ink-100)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                  )}
                >
                  {value === 'table' ? 'Table' : 'Chart'}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={downloadTable}>Download table</Button>
            <Button size="sm" onClick={downloadValues}>Download values</Button>
            <Button size="sm" variant="ghost" onClick={copyUrl}>{copied ? 'Copied' : 'Copy DHIS2 query'}</Button>
          </div>
        }
      />
      <CardBody>
        {result.rows.length === 0 ? (
          <EmptyState title="DHIS2 has no values for this selection." description="Try other periods, or areas higher up the hierarchy." />
        ) : view === 'table' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {table.fixed.map((text) => (
                  <Badge key={text} tone="neutral">{text}</Badge>
                ))}
              </div>
              <Select label="Across the top" value={across} onChange={(event) => setAcross(event.target.value as Across)} className="w-[180px]">
                <option value="pe">Periods</option>
                <option value="ou">Areas</option>
                <option value="dx">Data</option>
              </Select>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <TableWrap>
                <thead>
                  <tr>
                    {table.rowHeaders.map((header) => (
                      <Th key={header}>{header}</Th>
                    ))}
                    {table.columns.map((column) => (
                      <Th key={column.id} align="right">
                        {column.name}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <Tr key={row.key}>
                      {row.label.map((text, index) => (
                        <Td key={index} className="text-[12px]">
                          {text}
                        </Td>
                      ))}
                      {row.cells.map((cell, index) => (
                        <Td key={index} align="right" numeric className="text-[12px]">
                          {cell === null ? <span className="text-[var(--text-tertiary)]">–</span> : fmt.format(cell)}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </div>
        ) : chartable ? (
          <div className="flex flex-col gap-2">
            <LineChart
              labels={byPeriod.columns.map((column) => column.name)}
              series={series.map((row) => ({ id: row.key, label: row.label.join(' · '), values: row.cells }))}
              height={280}
            />
            {byPeriod.rows.length > 4 ? (
              <p className="text-[12px] text-[var(--text-tertiary)]">
                The chart shows the first 4 of {byPeriod.rows.length} series. The table has them all.
              </p>
            ) : null}
          </div>
        ) : (
          <Bars pivot={byPeriod} />
        )}
      </CardBody>
    </Card>
  );
}

/** One period: a ranked bar per row, labelled directly. */
function Bars({ pivot: table }: { pivot: Pivot }) {
  const rows = table.rows
    .map((row) => ({ label: row.label.join(' · '), value: row.cells[0] }))
    .filter((row): row is { label: string; value: number } => row.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 30);
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] text-[var(--text-tertiary)]">{table.columns[0]?.name}{table.rows.length > 30 ? ` · top 30 of ${table.rows.length}` : ''}</p>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_72px] items-center gap-3 text-[12px]">
          <span className="truncate text-[var(--text-secondary)]" title={row.label}>{row.label}</span>
          <span className="h-3 rounded-sm bg-[var(--viz-series-1)]" style={{ width: `${(Math.abs(row.value) / max) * 100}%` }} />
          <span className="numeric text-right">{fmt.format(row.value)}</span>
        </div>
      ))}
    </div>
  );
}
