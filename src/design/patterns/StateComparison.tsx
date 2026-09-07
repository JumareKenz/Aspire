import Link from 'next/link';
import type { StateComparison } from '@/services/states';
import { Card, CardBody, CardHeader } from '../primitives/Card';
import { TableWrap, Td, Th, Tr } from '../primitives/Table';
import { StatusPill } from '../primitives/StatusPill';
import { ConfidenceDisplay } from '../primitives/Score';
import { ScoreBar } from '../charts/ScoreBar';

/**
 * Side-by-side comparison of the programme states.
 *
 * Shown only to users whose geographic scope actually contains more than one
 * state — it is scope, not role, that decides this. A state-scoped user never
 * sees it, and could not read the other state's figures if they did.
 *
 * The point of the panel is the *difference*, so it leads with where the two
 * states diverge most and where they are moving in opposite directions, rather
 * than making the reader diff two columns of numbers themselves.
 */
export function StateComparisonPanel({
  comparison,
  periodId,
}: {
  comparison: StateComparison;
  periodId: string;
}) {
  const { states, domains, widestGaps, diverging } = comparison;
  const ranked = [...states].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const leader = ranked[0];
  const trailer = ranked[ranked.length - 1];
  const gap =
    leader.score !== null && trailer.score !== null
      ? Math.round((leader.score - trailer.score) * 10) / 10
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <Card className="p-5">
        <h3 className="text-[13px] font-semibold">Where the states differ</h3>
        <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {gap !== null ? (
            <li>
              <span className="font-medium text-[var(--text-primary)]">{leader.name}</span> leads{' '}
              {trailer.name} by {gap} points overall ({leader.score} against {trailer.score}).
            </li>
          ) : null}
          {widestGaps.length > 0 && widestGaps[0].spread !== null ? (
            <li>
              The widest domain gap is{' '}
              <span className="font-medium text-[var(--text-primary)]">{widestGaps[0].name}</span>,{' '}
              {widestGaps[0].spread} points apart.
            </li>
          ) : null}
          {diverging.length > 0 ? (
            <li>
              <span className="font-medium text-[var(--text-primary)]">{diverging[0].name}</span> is
              improving in {diverging[0].improvingState} while declining in{' '}
              {diverging[0].decliningState}.
            </li>
          ) : (
            <li>No domain is moving in opposite directions across the two states.</li>
          )}
          {states.some((state) => state.confidenceBand !== 'HIGH') ? (
            <li>
              Data confidence differs:{' '}
              {states.map((state) => `${state.name} ${state.dataConfidence}%`).join(', ')}. Read the
              comparison with that in mind.
            </li>
          ) : null}
        </ul>

        <dl className="mt-5 space-y-3 border-t pt-4">
          {states.map((state) => (
            <div key={state.orgUnitId} className="flex items-center justify-between gap-3">
              <dt className="min-w-0">
                <Link
                  href={`/performance?orgUnit=${state.orgUnitId}&period=${periodId}`}
                  className="text-[13px] font-medium hover:text-[var(--brand-600)] hover:underline"
                >
                  {state.name}
                </Link>
              </dt>
              <dd className="flex items-center gap-3">
                <ConfidenceDisplay
                  score={state.dataConfidence}
                  band={state.confidenceBand}
                  size="sm"
                  hideLabel
                />
                <span className="numeric w-10 text-right text-[15px] font-semibold">
                  {state.score ?? '—'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Domain by domain"
          description="Same methodology applied to each state, so the columns are comparable."
        />
        <CardBody>
          <TableWrap>
            <thead>
              <tr>
                <Th width="30%">Domain</Th>
                {states.map((state) => (
                  <Th key={state.orgUnitId} align="right" width="22%">
                    {state.name.replace(' State', '')}
                  </Th>
                ))}
                <Th align="right" width="14%">
                  Gap
                </Th>
              </tr>
            </thead>
            <tbody>
              {domains.map((row) => (
                <Tr key={row.domainId}>
                  <Td className="text-[12px]">{row.name}</Td>
                  {states.map((state) => {
                    const value = row.scores[state.orgUnitId];
                    const leads = row.leaderId === state.orgUnitId && states.length > 1;
                    return (
                      <Td key={state.orgUnitId} align="right" numeric>
                        <span className={leads ? 'font-semibold text-[var(--text-primary)]' : undefined}>
                          {value ?? '—'}
                        </span>
                      </Td>
                    );
                  })}
                  <Td align="right" numeric className="text-[var(--text-tertiary)]">
                    {row.spread ?? '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </CardBody>
      </Card>
    </div>
  );
}

/** Compact per-state summary used above the comparison table. */
export function StateSummaryRow({
  comparison,
  periodId,
}: {
  comparison: StateComparison;
  periodId: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {comparison.states.map((state) => (
        <Card key={state.orgUnitId} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/performance?orgUnit=${state.orgUnitId}&period=${periodId}`}
                className="text-[13px] font-medium hover:text-[var(--brand-600)] hover:underline"
              >
                {state.name}
              </Link>
              <p className="numeric mt-1.5 text-[26px] leading-none font-semibold">
                {state.score ?? '—'}
                <span className="ml-1 text-[12px] font-normal text-[var(--text-tertiary)]">/ 100</span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusPill status={state.status} />
              {state.changePoints !== null ? (
                <span
                  className={`numeric text-[12px] font-medium ${
                    state.changePoints < 0
                      ? 'text-[var(--concern-600)]'
                      : state.changePoints > 0
                        ? 'text-[var(--positive-600)]'
                        : 'text-[var(--text-tertiary)]'
                  }`}
                >
                  {state.changePoints > 0 ? '+' : ''}
                  {state.changePoints} pts
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-3">
            <ScoreBar score={state.score} target={75} status={state.status} />
          </div>
        </Card>
      ))}
    </div>
  );
}
