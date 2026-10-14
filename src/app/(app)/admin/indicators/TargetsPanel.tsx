'use client';

import { useEffect, useState } from 'react';
import type { IndicatorDefinition } from '@/core/registry/types';
import type { OrgLevel, PeriodType } from '@/core/model/types';
import type { TargetListing } from '@/services/targetAdmin';
import { validateTargetValue } from '@/core/targets/resolve';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { Button } from '@/design/primitives/Button';
import { Select, TextInput } from '@/design/primitives/Field';
import { LEVEL_LABEL } from '@/design/patterns/levels';

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; message: string } | { kind: 'error'; message: string };

async function call(method: 'GET' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<TargetListing> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const payload = (await response.json()) as { data?: TargetListing; error?: { message: string } };
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The change could not be saved.');
  return payload.data;
}

/**
 * Target setting for one indicator.
 *
 * A target is set for an area (or the whole programme) and a period: one
 * month or quarter, every month or every quarter, or every period. The most
 * specific one applies. Setting a target for one period leaves every other
 * period exactly as it was, so history is not re-scored; changing the
 * programme default does re-score every period that has no target of its own,
 * and the form says so before it is saved.
 *
 * Count indicators take targets per area only, because a count target for one
 * population is meaningless for another — and per period type, because a
 * quarter's count is not three months'.
 */
export function TargetsPanel({
  indicator,
  canManage,
  globalScope,
  areas,
  periods,
  onChanged,
}: {
  indicator: IndicatorDefinition;
  canManage: boolean;
  globalScope: boolean;
  areas: Array<{ id: string; name: string; level: OrgLevel }>;
  periods: Array<{ id: string; label: string; type: PeriodType }>;
  onChanged: () => void;
}) {
  const count = indicator.unit === 'COUNT';
  const [listing, setListing] = useState<TargetListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [area, setArea] = useState<string>(globalScope && !count ? '' : (areas[0]?.id ?? ''));
  const [period, setPeriod] = useState<string>(count ? indicator.frequency : '');
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    call('GET', `/api/admin/targets?indicator=${encodeURIComponent(indicator.id)}`)
      .then(setListing)
      .catch((error: Error) => setLoadError(error.message));
  }, [indicator.id]);

  const suffix = indicator.unit === 'PERCENT' ? '%' : '';
  const trimmed = value.trim();
  const numeric = trimmed === '' ? Number.NaN : Number(trimmed);
  const problem = trimmed === '' ? null : validateTargetValue(indicator, numeric);
  const existing = listing?.rows.find(
    (row) => (row.orgUnitId ?? '') === area && (row.periodId ?? '') === period,
  );
  const reScoresHistory = area === '' && period === '';

  async function save() {
    if (trimmed === '' || problem) return;
    setStatus({ kind: 'saving' });
    try {
      const next = await call('PUT', '/api/admin/targets', {
        indicatorId: indicator.id,
        orgUnitId: area === '' ? null : area,
        periodId: period === '' ? null : period,
        value: numeric,
      });
      setListing(next);
      setValue('');
      setStatus({ kind: 'saved', message: existing ? `Target updated from ${existing.value}${suffix} to ${numeric}${suffix}.` : 'Target saved.' });
      onChanged();
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  async function remove(row: TargetListing['rows'][number]) {
    setStatus({ kind: 'saving' });
    try {
      const next = await call('DELETE', '/api/admin/targets', {
        indicatorId: indicator.id,
        orgUnitId: row.orgUnitId,
        periodId: row.periodId,
      });
      setListing(next);
      setStatus({ kind: 'saved', message: 'Target removed. The next most specific target now applies.' });
      onChanged();
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        {count
          ? 'Counts are scored only against a target set for that area and period type. Nothing is divided from a parent area or from a longer period.'
          : 'The most specific target applies: an area over the programme, and one period over every month or quarter over every period.'}
      </p>

      {loadError ? (
        <p role="alert" className="text-[12px] text-[var(--concern-600)]">
          {loadError}
        </p>
      ) : listing === null ? (
        <p className="text-[12px] text-[var(--text-tertiary)]">Loading targets…</p>
      ) : listing.rows.length === 0 ? (
        <p className="text-[12px] text-[var(--text-tertiary)]">No targets set.</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Area</Th>
              <Th>Period</Th>
              <Th align="right">Target</Th>
              {canManage ? <Th align="right">{''}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {listing.rows.map((row) => {
              const ignored = count && row.orgUnitId === null;
              return (
                <Tr key={`${row.orgUnitId ?? ''}|${row.periodId ?? ''}`}>
                  <Td className="text-[12px]">{row.orgUnitName ?? 'Programme-wide'}</Td>
                  <Td className="text-[12px] text-[var(--text-secondary)]">{row.periodLabel}</Td>
                  <Td align="right" numeric className="text-[12px]">
                    {row.value.toLocaleString('en-GB')}
                    {suffix}
                    {ignored ? (
                      <span className="block text-[10px] text-[var(--text-tertiary)]">not applied to counts</span>
                    ) : null}
                  </Td>
                  {canManage ? (
                    <Td align="right">
                      {row.orgUnitId !== null || row.periodId !== null ? (
                        <button
                          type="button"
                          onClick={() => void remove(row)}
                          disabled={status.kind === 'saving'}
                          className="text-[11px] text-[var(--concern-600)] hover:underline disabled:opacity-50"
                          aria-label={`Remove the target for ${row.orgUnitName ?? 'the programme'}, ${row.periodLabel}`}
                        >
                          Remove
                        </button>
                      ) : null}
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      {canManage ? (
        <form
          className="space-y-2 rounded-[var(--radius-md)] border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Select label="Area" value={area} onChange={(event) => setArea(event.target.value)}>
              {globalScope && !count ? <option value="">Programme-wide</option> : null}
              {areas.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name} · {LEVEL_LABEL[unit.level]}
                </option>
              ))}
            </Select>
            <Select label="Period" value={period} onChange={(event) => setPeriod(event.target.value)}>
              {!count ? <option value="">Every period</option> : null}
              <option value="QUARTERLY">Every quarter</option>
              <option value="MONTHLY">Every month</option>
              <optgroup label="One quarter">
                {periods.filter((entry) => entry.type === 'QUARTERLY').map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="One month">
                {periods.filter((entry) => entry.type === 'MONTHLY').map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            </Select>
            <TextInput
              label={`Target${suffix ? ` (${suffix})` : ''}`}
              inputMode="decimal"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setStatus({ kind: 'idle' });
              }}
              aria-invalid={problem ? true : undefined}
              placeholder={existing ? String(existing.value) : undefined}
            />
          </div>
          {problem ? (
            <p role="alert" className="text-[12px] text-[var(--concern-600)]">
              {problem}
            </p>
          ) : null}
          {existing && trimmed !== '' && !problem ? (
            <p className="text-[12px] text-[var(--warning-700)]">
              This replaces the existing target of {existing.value}
              {suffix} for the same area and period; no second target is created.
            </p>
          ) : null}
          {reScoresHistory && trimmed !== '' && !problem ? (
            <p className="text-[12px] text-[var(--warning-700)]">
              The programme default applies to every past and future period without its own target, so changing it
              re-scores those periods. To change the target from one period on, set it for that period instead.
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" variant="primary" disabled={trimmed === '' || Boolean(problem) || status.kind === 'saving'}>
              {status.kind === 'saving' ? 'Saving…' : existing ? 'Update target' : 'Set target'}
            </Button>
            <p aria-live="polite" className="text-[12px]">
              {status.kind === 'saved' ? <span className="text-[var(--positive-700)]">{status.message}</span> : null}
              {status.kind === 'error' ? <span className="text-[var(--concern-600)]">{status.message}</span> : null}
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
