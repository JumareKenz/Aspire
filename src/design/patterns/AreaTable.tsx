import Link from 'next/link';
import type { RankedUnit } from '@/core/analytics/attribution';
import type { Scorecard } from '@/core/scoring/types';
import { TableWrap, Td, Th, Tr } from '../primitives/Table';
import { StatusPill } from '../primitives/StatusPill';
import { ScoreBar } from '../charts/ScoreBar';
import { Sparkline } from '../charts/Sparkline';
import { ConfidenceDisplay } from '../primitives/Score';

export interface AreaRow extends RankedUnit {
  /** Overall-score history for the sparkline, oldest first. */
  history: Array<number | null>;
  level: Scorecard['orgUnitLevel'];
}

/**
 * Ranked areas with drill-down.
 *
 * Rank, score, movement, shape and data confidence in one row: enough to decide
 * where to look next without opening anything. The name is the link, so the
 * drill-down target is obvious rather than hidden behind a chevron.
 */
export function AreaTable({ rows, periodId }: { rows: AreaRow[]; periodId: string }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th width="4%" align="right">
            #
          </Th>
          <Th width="27%">Area</Th>
          <Th align="right" width="8%">
            Score
          </Th>
          <Th width="16%">Against threshold</Th>
          <Th align="right" width="9%">
            Change
          </Th>
          <Th width="12%">Last 12 periods</Th>
          <Th width="15%">Status</Th>
          <Th width="11%">Data confidence</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.orgUnitId} interactive>
            <Td align="right" numeric className="text-[var(--text-tertiary)]">
              {row.rank}
            </Td>
            <Td>
              <Link
                href={`/performance?orgUnit=${row.orgUnitId}&period=${periodId}`}
                className="font-medium text-[var(--text-primary)] hover:text-[var(--brand-600)] hover:underline"
              >
                {row.orgUnitName}
              </Link>
            </Td>
            <Td align="right" numeric className="font-semibold">
              {row.score ?? '—'}
            </Td>
            <Td>
              <ScoreBar score={row.score} target={75} status={row.status} />
            </Td>
            <Td align="right" numeric>
              {row.changePoints === null ? (
                <span className="text-[var(--text-tertiary)]">—</span>
              ) : (
                <span
                  className={
                    row.changePoints > 0
                      ? 'text-[var(--positive-600)]'
                      : row.changePoints < 0
                        ? 'text-[var(--concern-600)]'
                        : 'text-[var(--text-tertiary)]'
                  }
                >
                  {row.changePoints > 0 ? '+' : ''}
                  {row.changePoints}
                </span>
              )}
            </Td>
            <Td>
              <Sparkline
                values={row.history}
                label={`Overall score history for ${row.orgUnitName}`}
                tone={
                  row.changePoints !== null && row.changePoints < -2
                    ? 'concern'
                    : row.changePoints !== null && row.changePoints > 2
                      ? 'positive'
                      : 'neutral'
                }
              />
            </Td>
            <Td>
              <StatusPill status={row.status} />
            </Td>
            <Td>
              <ConfidenceDisplay
                score={row.dataConfidence}
                band={row.dataConfidence >= 80 ? 'HIGH' : row.dataConfidence >= 55 ? 'MODERATE' : 'LOW'}
                size="sm"
                hideLabel
              />
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
