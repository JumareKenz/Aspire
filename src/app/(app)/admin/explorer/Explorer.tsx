'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Catalogue, CatalogueItem, ExplorerResult } from '@/services/explorer';
import { Badge } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Card } from '@/design/primitives/Card';
import { Drawer } from '@/design/primitives/Drawer';
import { Select } from '@/design/primitives/Field';
import { EmptyState, ErrorState, LoadingBlock } from '@/design/primitives/States';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { LineChart } from '@/design/charts/LineChart';
import { cn } from '@/design/primitives/cn';
import { callApi, saveText, toCsv } from './api';
import { DataPicker } from './DataPicker';
import { OrgUnitPicker, type PickedUnit } from './OrgUnitPicker';
import { RELATIVE, periodLabel, recentPeriods, type PeriodType } from './periods';
import { Chip, ScrollArea } from '../ui';

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
  const [roots, setRoots] = useState<PickedUnit[]>([]);
  const [level, setLevel] = useState<Level | ''>('');
  const [category, setCategory] = useState('');
  const [result, setResult] = useState<ExplorerResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [across, setAcross] = useState<Across>('pe');
  const [panel, setPanel] = useState<'data' | 'periods' | 'areas' | null>(null);

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
    callApi<Array<{ id: string; name: string; level: PickedUnit['level'] }>>('/api/admin/explorer/orgunits')
      .then((list) => setRoots(list.map((unit) => ({ id: unit.id, name: unit.name, level: unit.level }))))
      .catch(() => setRoots([]));
  }, []);

  const toggle = <T extends { id: string }>(list: T[], item: T) =>
    list.some((entry) => entry.id === item.id) ? list.filter((entry) => entry.id !== item.id) : [...list, item];

  // A split by category needs exactly one data element that has categories;
  // a choice that no longer applies is simply not used.
  const splittable = data.length === 1 && data[0].kind === 'DATA_ELEMENT' ? data[0].categories : [];
  const split = splittable.some((option) => option.id === category) ? category : '';

  const ready = data.length > 0 && periods.length > 0 && units.length > 0;
  const missing = [data.length === 0 && 'data', periods.length === 0 && 'periods', units.length === 0 && 'areas'].filter(Boolean);

  async function run(query?: { dx: string[]; periods: string[]; orgUnits: string[]; level: Level | null; category: string | null }) {
    setRunning(true);
    setError(null);
    try {
      const next = await callApi<ExplorerResult>('/api/admin/explorer/query', {
        method: 'POST',
        body: JSON.stringify(
          query ?? {
            dx: data.map((item) => item.id),
            periods,
            orgUnits: units.map((unit) => unit.id),
            level: level || null,
            category: split || null,
          },
        ),
      });
      setResult(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The query failed.');
    } finally {
      setRunning(false);
    }
  }

  /** A worked example, so the first visit shows what the explorer does. */
  const example = catalogue?.items.find((item) => item.id === 'Ly3HmUoHQEP') ?? catalogue?.items.find((item) => item.usedBy && item.kind === 'INDICATOR');
  function tryExample() {
    if (!example || roots.length === 0) return;
    setData([example]);
    setPeriods(['LAST_4_QUARTERS']);
    setUnits(roots);
    setLevel('STATE');
    void run({ dx: [example.id], periods: ['LAST_4_QUARTERS'], orgUnits: roots.map((unit) => unit.id), level: 'STATE', category: null });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Build a query" className="grid gap-4 md:grid-cols-3">
        <BuilderCard
          step="Data"
          title={data.length === 0 ? 'Choose what to measure' : `${data.length} ${data.length === 1 ? 'item' : 'items'}`}
          empty="Indicators or data elements"
          items={data.map((item) => ({ id: item.id, label: item.name }))}
          onRemove={(id) => setData((list) => list.filter((item) => item.id !== id))}
          onEdit={() => setPanel('data')}
          loading={!catalogue && !catalogueError}
        />
        <BuilderCard
          step="Periods"
          title={periods.length === 0 ? 'Choose when' : `${periods.length} ${periods.length === 1 ? 'period' : 'periods'}`}
          empty="Months, quarters or years"
          items={periods.map((id) => ({ id, label: periodLabel(id) }))}
          onRemove={(id) => setPeriods((list) => list.filter((entry) => entry !== id))}
          onEdit={() => setPanel('periods')}
        />
        <BuilderCard
          step="Areas"
          title={units.length === 0 ? 'Choose where' : `${units.length} ${units.length === 1 ? 'area' : 'areas'}`}
          empty="States, LGAs, wards or facilities"
          items={units.map((unit) => ({ id: unit.id, label: unit.name }))}
          onRemove={(id) => setUnits((list) => list.filter((unit) => unit.id !== id))}
          onEdit={() => setPanel('areas')}
        />
      </section>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:max-w-2xl">
          <Select label="Show values for" value={level} onChange={(event) => setLevel(event.target.value as Level | '')}>
            <option value="">The selected areas</option>
            <option value="STATE">Each state within them</option>
            <option value="LGA">Each LGA within them</option>
            <option value="WARD">Each ward within them</option>
            <option value="FACILITY">Each facility within them</option>
          </Select>
          <Select
            label="Split by"
            value={split}
            onChange={(event) => setCategory(event.target.value)}
            disabled={splittable.length === 0}
            title={splittable.length === 0 ? 'Available when one data element with categories is chosen' : undefined}
          >
            <option value="">{splittable.length === 0 ? 'Choose one data element to split' : 'No split (totals)'}</option>
            {splittable.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <Button variant="primary" onClick={() => run()} disabled={!ready || running} className="h-10 px-6 text-[14px]">
            {running ? 'Running…' : 'Run query'}
          </Button>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {ready ? 'Runs live against DHIS2' : `Choose ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')} first`}
          </p>
        </div>
      </Card>

      {error ? <ErrorState title="The query did not run." description={error} /> : null}

      {result ? (
        <Results result={result} view={view} setView={setView} across={across} setAcross={setAcross} />
      ) : !error ? (
        <Card className="flex flex-col items-center gap-5 px-6 py-14 text-center">
          <div className="grid gap-6 text-left sm:grid-cols-3 sm:gap-10">
            {[
              ['1', 'Choose data', 'Any indicator or data element on the connected instance.'],
              ['2', 'Choose periods and areas', 'Relative periods like “last 4 quarters”, and any area in your access.'],
              ['3', 'Run and explore', 'Pivot the table, switch to a chart, download or reproduce in DHIS2.'],
            ].map(([n, title, text]) => (
              <div key={n} className="flex max-w-[240px] gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-050)] text-[12px] font-semibold text-[var(--brand-700)]">{n}</span>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-tertiary)]">{text}</p>
                </div>
              </div>
            ))}
          </div>
          {example && roots.length > 0 ? (
            <Button onClick={tryExample} disabled={running}>
              Try an example: {example.name}, last 4 quarters, by state
            </Button>
          ) : null}
        </Card>
      ) : null}

      <p className="text-[12px] text-[var(--text-tertiary)]">
        Source <span className="font-mono">{source.replace(/^https?:\/\//, '')}</span>
        {catalogue ? (
          <>
            {' '}· catalogue of {catalogue.items.length.toLocaleString('en-GB')} items loaded{' '}
            {new Date(catalogue.loadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })} ·{' '}
            <button type="button" className="text-[var(--brand-600)] hover:underline" onClick={() => loadCatalogue(true)}>
              reload
            </button>
          </>
        ) : null}
      </p>

      <Drawer
        open={panel === 'data'}
        onClose={() => setPanel(null)}
        title="Choose data"
        description="Indicators or data elements from the connected instance. Select as many as you need."
        width="lg"
        footer={<DrawerFooter count={data.length} noun="item" onClear={() => setData([])} onDone={() => setPanel(null)} />}
      >
        {catalogueError ? (
          <ErrorState title="The DHIS2 catalogue could not be loaded." description={catalogueError} />
        ) : catalogue ? (
          <DataPicker items={catalogue.items} selected={data} onToggle={(item) => setData((list) => toggle(list, item))} />
        ) : (
          <LoadingBlock rows={6} />
        )}
      </Drawer>

      <Drawer
        open={panel === 'periods'}
        onClose={() => setPanel(null)}
        title="Choose periods"
        description="Relative periods move with time; fixed periods stay put."
        footer={<DrawerFooter count={periods.length} noun="period" onClear={() => setPeriods([])} onDone={() => setPanel(null)} />}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">Relative</p>
            <div className="flex flex-wrap gap-2">
              {RELATIVE.map((option) => (
                <Toggle key={option.id} on={periods.includes(option.id)} onClick={() => setPeriods((list) => flip(list, option.id))}>
                  {option.label}
                </Toggle>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">Fixed</p>
              <Select label="Period type" hideLabel value={periodType} onChange={(event) => setPeriodType(event.target.value as PeriodType)} className="w-[140px]">
                <option value="MONTHLY">Months</option>
                <option value="QUARTERLY">Quarters</option>
                <option value="YEARLY">Years</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {recentPeriods(periodType).map((option) => (
                <Toggle key={option.id} on={periods.includes(option.id)} onClick={() => setPeriods((list) => flip(list, option.id))}>
                  {option.label}
                </Toggle>
              ))}
            </div>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={panel === 'areas'}
        onClose={() => setPanel(null)}
        title="Choose areas"
        description="Areas in your access. Choose “Show values for” to break them down, e.g. every LGA within a state."
        footer={<DrawerFooter count={units.length} noun="area" onClear={() => setUnits([])} onDone={() => setPanel(null)} />}
      >
        <OrgUnitPicker selected={units} onToggle={(unit) => setUnits((list) => toggle(list, unit))} />
      </Drawer>
    </div>
  );
}

function flip(list: string[], id: string) {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius-md)] border px-3 py-2 text-[13px] transition-colors duration-150',
        on
          ? 'border-[var(--brand-600)] bg-[var(--brand-050)] font-medium text-[var(--brand-700)]'
          : 'text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
      )}
    >
      {children}
    </button>
  );
}

/** One of the three query parts: what is chosen, and a way to change it. */
function BuilderCard({
  step,
  title,
  empty,
  items,
  onRemove,
  onEdit,
  loading = false,
}: {
  step: string;
  title: string;
  empty: string;
  items: Array<{ id: string; label: string }>;
  onRemove: (id: string) => void;
  onEdit: () => void;
  loading?: boolean;
}) {
  const shown = items.slice(0, 4);
  return (
    <Card className={cn('flex min-h-[148px] flex-col gap-4 p-5 transition-colors', items.length > 0 && 'border-[var(--brand-200)]')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{step}</p>
          <p className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">{title}</p>
        </div>
        <Button size="sm" variant={items.length === 0 ? 'primary' : 'secondary'} onClick={onEdit} disabled={loading}>
          {loading ? 'Loading…' : items.length === 0 ? 'Choose' : 'Edit'}
        </Button>
      </div>
      {items.length === 0 ? (
        <button
          type="button"
          onClick={onEdit}
          disabled={loading}
          className="flex flex-1 items-center justify-center rounded-[var(--radius-lg)] border border-dashed px-4 text-[12px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--brand-400)] hover:text-[var(--text-secondary)]"
        >
          {empty}
        </button>
      ) : (
        <div className="flex flex-wrap content-start gap-2">
          {shown.map((item) => (
            <Chip key={item.id} onRemove={() => onRemove(item.id)}>
              {item.label}
            </Chip>
          ))}
          {items.length > shown.length ? (
            <button type="button" onClick={onEdit} className="rounded-full px-2 py-1 text-[12px] font-medium text-[var(--brand-600)] hover:underline">
              +{items.length - shown.length} more
            </button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function DrawerFooter({ count, noun, onClear, onDone }: { count: number; noun: string; onClear: () => void; onDone: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[13px] text-[var(--text-secondary)]">
        {count === 0 ? `No ${noun}s chosen` : `${count} ${count === 1 ? noun : `${noun}s`} chosen`}
      </p>
      <div className="flex gap-2">
        {count > 0 ? (
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        ) : null}
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
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
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Result</h2>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            {result.rows.length.toLocaleString('en-GB')} values from DHIS2 in {(result.durationMs / 1000).toFixed(1)} s
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="View" className="flex rounded-full border bg-[var(--surface-sunken)] p-1">
            {(['table', 'chart'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors',
                  view === value ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
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
      </div>

      {result.rows.length === 0 ? (
        <EmptyState title="DHIS2 has no values for this selection." description="Try other periods, or areas higher up the hierarchy." />
      ) : view === 'table' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap gap-2">
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
          <ScrollArea maxHeight={600}>
            <TableWrap>
              <thead>
                <tr>
                  {table.rowHeaders.map((header, index) => (
                    <Th key={header} className={cn(index === 0 && 'left-0 z-20')}>
                      {header}
                    </Th>
                  ))}
                  {table.columns.map((column) => (
                    <Th key={column.id} align="right" className="whitespace-nowrap">
                      {column.name}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <Tr key={row.key}>
                    {row.label.map((text, index) => (
                      <Td
                        key={index}
                        className={cn('text-[13px]', index === 0 && 'sticky left-0 z-[1] bg-[var(--surface)] font-medium')}
                      >
                        {text}
                      </Td>
                    ))}
                    {row.cells.map((cell, index) => (
                      <Td key={index} align="right" numeric className="text-[13px]">
                        {cell === null ? <span className="text-[var(--text-tertiary)]">–</span> : fmt.format(cell)}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </ScrollArea>
        </div>
      ) : chartable ? (
        <div className="flex flex-col gap-3">
          <LineChart
            labels={byPeriod.columns.map((column) => column.name)}
            series={series.map((row) => ({ id: row.key, label: row.label.join(' · '), values: row.cells }))}
            height={320}
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
