'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Insight } from '@/core/insight/types';
import { Drawer } from '@/design/primitives/Drawer';
import { EvidenceList } from '@/design/primitives/Meta';
import { SeverityPill } from '@/design/primitives/StatusPill';
import { ButtonLink } from '@/design/primitives/Button';

const KIND_LABEL: Record<Insight['kind'], string> = {
  BELOW_TARGET: 'Below threshold',
  DECLINE: 'Decline',
  IMPROVEMENT: 'Improvement',
  DATA_QUALITY: 'Data quality',
  RISK: 'Risk',
  CHANGE: 'Change driver',
};

/**
 * Insights are clickable because the point of an insight is to be examined.
 * Selecting one opens the evidence it was derived from, then offers the route
 * into the workspace where it can be investigated properly.
 */
export function InsightList({ insights }: { insights: Insight[] }) {
  const [selected, setSelected] = useState<Insight | null>(null);

  return (
    <>
      <ul className="divide-y">
        {insights.map((insight) => (
          <li key={insight.id}>
            <button
              type="button"
              onClick={() => setSelected(insight)}
              className="group flex w-full items-start gap-3 px-1 py-3 text-left transition-colors duration-100 hover:bg-[var(--ink-050)]"
            >
              <span className="mt-0.5 shrink-0">
                <SeverityPill severity={insight.severity} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                  {insight.headline}
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                  {insight.detail}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="mt-1 shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100"
              >
                →
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.headline ?? ''}
        description={selected ? KIND_LABEL[selected.kind] : undefined}
        footer={
          selected ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Derived from stored reporting for {selected.periodId}.
              </p>
              <ButtonLink href={selected.href} variant="primary" size="sm">
                Investigate
              </ButtonLink>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-5">
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{selected.detail}</p>
            <div>
              <h3 className="mb-2 text-[12px] font-semibold text-[var(--text-primary)]">Evidence</h3>
              <EvidenceList items={selected.evidence} />
            </div>
            {selected.orgUnitId ? (
              <p className="text-[12px] text-[var(--text-tertiary)]">
                Scope:{' '}
                <Link
                  href={`/performance?orgUnit=${selected.orgUnitId}&period=${selected.periodId}`}
                  className="text-[var(--brand-600)] underline underline-offset-2"
                >
                  {selected.orgUnitName}
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
