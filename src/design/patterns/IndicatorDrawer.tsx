'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { IndicatorDetail } from '@/services/indicators';
import { Drawer } from '../primitives/Drawer';
import { LineChart } from '../charts/LineChart';
import { StatusPill, SeverityPill } from '../primitives/StatusPill';
import { TrendIndicator } from '../primitives/Trend';
import { Badge } from '../primitives/Badge';
import { ErrorState, LoadingBlock } from '../primitives/States';
import { Td, Th, TableWrap, Tr } from '../primitives/Table';
import { isMapped } from '@/core/registry/mapping';

export interface IndicatorDrawerTarget {
  indicatorId: string;
  orgUnitId: string;
  periodId: string;
}

const UNIT_SUFFIX: Record<string, string> = {
  PERCENT: '%',
  RATE_PER_1000: ' per 1,000',
  RATE_PER_100000: ' per 100,000',
  COUNT: '',
  RATIO: '',
};

/**
 * Indicator drill-down.
 *
 * Opens over the scorecard so the user keeps their place, and answers the three
 * questions a number on a scorecard raises: what has it been doing, who
 * underneath is moving it, and can I trust it.
 */
export function IndicatorDrawer({
  target,
  onClose,
}: {
  target: IndicatorDrawerTarget | null;
  onClose: () => void;
}) {
  // The loaded detail is stored with the target it belongs to, so switching
  // indicators shows a loading state rather than the previous indicator's
  // figures — and clearing it needs no synchronous setState in an effect.
  const [loaded, setLoaded] = useState<{ key: string; detail: IndicatorDetail } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const targetKey = target ? `${target.orgUnitId}|${target.indicatorId}|${target.periodId}` : null;
  const detail = loaded && loaded.key === targetKey ? loaded.detail : null;
  // An error is scoped to the request that produced it, so opening a different
  // indicator starts clean rather than inheriting the previous failure.
  const error = failure && failure.key === targetKey ? failure.message : null;
  const loading = target !== null && detail === null && error === null;

  useEffect(() => {
    if (!target || !targetKey) return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams({
      orgUnit: target.orgUnitId,
      indicator: target.indicatorId,
      period: target.periodId,
    });
    fetch(`/api/indicator?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as
          | { data: IndicatorDetail }
          | { error: { message: string } };
        if ('error' in payload) {
          setFailure({ key: targetKey, message: payload.error.message });
          return;
        }
        setLoaded({ key: targetKey, detail: payload.data });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setFailure({ key: targetKey, message: 'We could not load this indicator right now.' });
      });
    return () => controller.abort();
  }, [target, targetKey]);

  const suffix = detail ? (UNIT_SUFFIX[detail.indicator.unit] ?? '') : '';

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      width="lg"
      title={detail?.indicator.name ?? 'Indicator'}
      description={detail ? `${detail.orgUnitName} · ${detail.periodLabel}` : undefined}
    >
      {loading && !detail ? <LoadingBlock rows={6} /> : null}
      {error ? <ErrorState description={error} /> : null}

      {detail ? (
        <div className="space-y-6">
          <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            {detail.indicator.description}
          </p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-[var(--text-tertiary)]">Current</dt>
              <dd className="numeric mt-0.5 text-[18px] font-semibold">
                {detail.value === null ? '—' : `${detail.value}${suffix}`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--text-tertiary)]">
                {detail.indicator.targetOfficial ? 'Target' : 'Target (provisional)'}
              </dt>
              <dd className="numeric mt-0.5 text-[18px] font-semibold text-[var(--text-secondary)]">
                {detail.target}
                {suffix}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--text-tertiary)]">Achievement</dt>
              <dd className="numeric mt-0.5 text-[18px] font-semibold">
                {detail.achievementPct === null ? '—' : `${detail.achievementPct}%`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--text-tertiary)]">Trend</dt>
              <dd className="mt-1.5">
                <TrendIndicator trend={detail.trend} />
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={detail.status} />
            <Badge tone="neutral">
              {detail.indicator.directionality === 'HIGHER_IS_BETTER' ? 'Higher is better' : 'Lower is better'}
            </Badge>
            {!isMapped(detail.indicator) ? (
              <Badge tone="warning" title="No DHIS2 source has been mapped for this indicator.">
                Not reported by the data source
              </Badge>
            ) : null}
          </div>

          <section>
            <h3 className="mb-2 text-[12px] font-semibold">Reported values</h3>
            <LineChart
              labels={detail.labels}
              series={[{ id: detail.indicator.id, label: detail.indicator.shortName, values: detail.values }]}
              yLabel={detail.indicator.shortName}
              referenceValue={detail.target}
              referenceLabel="Target"
              valueSuffix={suffix}
              height={180}
            />
          </section>

          {detail.breakdown ? (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold">
                By {detail.breakdown.label.toLowerCase()}{' '}
                <span className="font-normal text-[var(--text-tertiary)]">
                  — {detail.breakdown.counts}, {detail.periodLabel}
                </span>
              </h3>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>{detail.breakdown.label}</Th>
                    <Th align="right">Count</Th>
                    <Th align="right">Share</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.breakdown.rows.map((row) => (
                    <Tr key={row.option}>
                      <Td>{row.option}</Td>
                      <Td align="right" className="numeric">
                        {row.value.toLocaleString('en-GB')}
                      </Td>
                      <Td align="right" className="numeric">
                        <span className="inline-flex items-center justify-end gap-2">
                          <span
                            aria-hidden="true"
                            className="inline-block h-1.5 rounded-full bg-[var(--brand-500)]"
                            style={{ width: `${Math.max(2, Math.round(row.share * 0.6))}px` }}
                          />
                          {row.share}%
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
          ) : null}

          <section>
            <h3 className="mb-1 text-[12px] font-semibold">Outlook</h3>
            {detail.forecast.available ? (
              <div className="rounded-[var(--radius-md)] border bg-[var(--surface-sunken)] px-3 py-2.5">
                <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  Projected {detail.forecast.points[detail.forecast.points.length - 1].value}
                  {suffix} by {detail.forecast.points[detail.forecast.points.length - 1].periodId}, within a
                  range of {detail.forecast.points[detail.forecast.points.length - 1].lower}
                  {suffix} to {detail.forecast.points[detail.forecast.points.length - 1].upper}
                  {suffix}.
                  {detail.forecast.targetMissProbability !== null
                    ? ` The model puts the chance of missing the target at ${Math.round(
                        detail.forecast.targetMissProbability * 100,
                      )}%.`
                    : ''}
                </p>
                <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">
                  {detail.forecast.modelId} {detail.forecast.modelVersion} · fitted on{' '}
                  {detail.forecast.observedPeriods} periods · model confidence{' '}
                  {Math.round(detail.forecast.confidence * 100)}%
                </p>
              </div>
            ) : (
              <p className="rounded-[var(--radius-md)] border border-dashed px-3 py-2.5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                {detail.forecast.reason}
              </p>
            )}
          </section>

          {detail.contributors.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold">
                Where this is moving{' '}
                <span className="font-normal text-[var(--text-tertiary)]">— largest declines first</span>
              </h3>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Area</Th>
                    <Th align="right">Value</Th>
                    <Th align="right">Change</Th>
                    <Th align="right">Trend</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.contributors.slice(0, 8).map((contributor) => (
                    <Tr key={contributor.orgUnitId}>
                      <Td>
                        <Link
                          href={`/performance?orgUnit=${contributor.orgUnitId}&period=${detail.periodId}`}
                          className="text-[var(--brand-600)] hover:underline"
                        >
                          {contributor.orgUnitName}
                        </Link>
                      </Td>
                      <Td align="right" numeric>
                        {contributor.value === null ? '—' : `${contributor.value}${suffix}`}
                      </Td>
                      <Td align="right" numeric>
                        {contributor.changePct === null
                          ? '—'
                          : `${contributor.changePct > 0 ? '+' : ''}${contributor.changePct}%`}
                      </Td>
                      <Td align="right">
                        <TrendIndicator trend={contributor.trend} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
          ) : null}

          {detail.findings.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold">Data-quality findings for this indicator</h3>
              <ul className="space-y-2">
                {detail.findings.slice(0, 5).map((finding) => (
                  <li key={finding.id} className="flex items-start gap-2.5">
                    <SeverityPill severity={finding.severity} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium">{finding.title}</p>
                      <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                        {finding.orgUnitName} · {finding.reason}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
