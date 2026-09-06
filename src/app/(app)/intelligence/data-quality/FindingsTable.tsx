'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { FindingStatus, QualityDimension, QualityFinding } from '@/core/quality/types';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { SeverityPill } from '@/design/primitives/StatusPill';
import { Badge } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Drawer } from '@/design/primitives/Drawer';
import { EvidenceList } from '@/design/primitives/Meta';
import { Select } from '@/design/primitives/Field';
import { EmptyState } from '@/design/primitives/States';

const DIMENSION_LABELS: Record<QualityDimension, string> = {
  COMPLETENESS: 'Completeness',
  TIMELINESS: 'Timeliness',
  VALIDITY: 'Validity',
  CONSISTENCY: 'Consistency',
  STATISTICAL: 'Statistical anomaly',
  TEMPORAL: 'Reporting pattern',
  REPEATED_VALUE: 'Repeated values',
};

const STATUS_LABELS: Record<FindingStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

/**
 * Data-quality findings with triage.
 *
 * Filtering happens in the browser because the whole scope's findings are
 * already on the page — a round trip per filter change would be slower and
 * would lose the user's place in the list.
 */
const PAGE_SIZE = 25;

export function FindingsTable({
  findings,
  periodId,
  canTriage,
}: {
  findings: QualityFinding[];
  periodId: string;
  canTriage: boolean;
}) {
  const [dimension, setDimension] = useState<string>('ALL');
  const [severity, setSeverity] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('OPEN');
  const [selected, setSelected] = useState<QualityFinding | null>(null);
  const [overrides, setOverrides] = useState<Record<string, FindingStatus>>({});
  const [pending, setPending] = useState(false);
  // Findings are shown a page at a time. A scope can produce dozens, and a
  // table that runs for several screens stops being something a person reads.
  const [visible, setVisible] = useState(PAGE_SIZE);

  const rows = useMemo(
    () =>
      findings
        .map((finding) => ({ ...finding, status: overrides[finding.id] ?? finding.status }))
        .filter(
          (finding) =>
            (dimension === 'ALL' || finding.dimension === dimension) &&
            (severity === 'ALL' || finding.severity === severity) &&
            (status === 'ALL' || finding.status === status),
        ),
    [findings, dimension, severity, status, overrides],
  );

  const shown = rows.slice(0, visible);

  // Changing a filter starts the list again from the top.
  function applyFilter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setVisible(PAGE_SIZE);
    };
  }

  async function triage(finding: QualityFinding, next: FindingStatus) {
    setPending(true);
    try {
      const response = await fetch('/api/findings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: finding.id, status: next }),
      });
      if (response.ok) {
        setOverrides((current) => ({ ...current, [finding.id]: next }));
        setSelected(null);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Select
          label="Type"
          value={dimension}
          onChange={(event) => applyFilter(setDimension)(event.target.value)}
          className="w-[168px]"
        >
          <option value="ALL">All types</option>
          {Object.entries(DIMENSION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label="Severity"
          value={severity}
          onChange={(event) => applyFilter(setSeverity)(event.target.value)}
          className="w-[148px]"
        >
          <option value="ALL">All severities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </Select>
        <Select
          label="Status"
          value={status}
          onChange={(event) => applyFilter(setStatus)(event.target.value)}
          className="w-[144px]"
        >
          <option value="ALL">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <p className="mb-1.5 text-[12px] text-[var(--text-tertiary)]">
          {rows.length === findings.length
            ? `${findings.length} findings`
            : `${rows.length} of ${findings.length} findings`}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No findings match these filters."
          description="Try widening the type, severity or status filter."
        />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th width="9%">Severity</Th>
              <Th width="15%">Type</Th>
              <Th width="20%">Area</Th>
              <Th>Issue</Th>
              <Th width="9%">Period</Th>
              <Th width="12%">Status</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((finding) => (
              <Tr key={finding.id} interactive>
                <Td>
                  <SeverityPill severity={finding.severity} />
                </Td>
                <Td className="text-[12px] text-[var(--text-secondary)]">
                  {DIMENSION_LABELS[finding.dimension]}
                </Td>
                <Td>
                  <Link
                    href={`/performance?orgUnit=${finding.orgUnitId}&period=${finding.periodId}`}
                    className="text-[var(--brand-600)] hover:underline"
                  >
                    {finding.orgUnitName}
                  </Link>
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => setSelected(finding)}
                    className="text-left hover:text-[var(--brand-600)] hover:underline"
                  >
                    {finding.title}
                  </button>
                </Td>
                <Td className="numeric text-[12px] text-[var(--text-tertiary)]">{finding.periodId}</Td>
                <Td>
                  <Badge tone={finding.status === 'OPEN' ? 'warning' : 'neutral'}>
                    {STATUS_LABELS[finding.status]}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {rows.length > shown.length ? (
        <div className="mt-3 flex items-center justify-center gap-3">
          <Button size="sm" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, rows.length - shown.length)} more
          </Button>
          <span className="text-[11px] text-[var(--text-tertiary)]">
            Showing {shown.length} of {rows.length}
          </span>
        </div>
      ) : null}

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ''}
        description={selected ? `${selected.orgUnitName} · ${selected.periodId}` : undefined}
        footer={
          selected && canTriage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={pending} onClick={() => void triage(selected, 'ACKNOWLEDGED')}>
                Acknowledge
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={pending}
                onClick={() => void triage(selected, 'RESOLVED')}
              >
                Mark resolved
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => void triage(selected, 'DISMISSED')}>
                Not an issue
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Triage requires programme or administrator access.
            </p>
          )
        }
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityPill severity={selected.severity} />
              <Badge tone="neutral">{DIMENSION_LABELS[selected.dimension]}</Badge>
              {selected.indicatorName ? <Badge tone="neutral">{selected.indicatorName}</Badge> : null}
            </div>
            <div>
              <h3 className="mb-1 text-[12px] font-semibold">Why this was flagged</h3>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{selected.reason}</p>
            </div>
            <div>
              <h3 className="mb-2 text-[12px] font-semibold">Evidence</h3>
              <EvidenceList items={selected.evidence} />
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Detected {new Date(selected.detectedAt).toLocaleString('en-GB')} during the reporting scan for{' '}
              {periodId}.
            </p>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
