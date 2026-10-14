'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IndicatorDefinition } from '@/core/registry/types';
import type { IndicatorProvenance, ProvenanceStatus } from '@/core/registry/provenance';
import type { DataMode, OrgLevel, PeriodType } from '@/core/model/types';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { Badge, type Tone } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Drawer } from '@/design/primitives/Drawer';
import { TextInput } from '@/design/primitives/Field';
import { mappingLabel } from '@/core/registry/mapping';
import { TargetsPanel } from './TargetsPanel';

export const PROVENANCE_META: Record<ProvenanceStatus, { label: string; tone: Tone; note: string }> = {
  VERIFIED: { label: 'NHMIS verified', tone: 'positive', note: 'Every operand is a data element on an approved NHMIS form.' },
  APPROVED_EXCEPTION: {
    label: 'Verified with exception',
    tone: 'info',
    note: 'Verified, except for operands an explicit, documented exception approves.',
  },
  UNVERIFIED: { label: 'Not verified', tone: 'concern', note: 'Excluded from reporting until every operand is verified.' },
  UNMAPPED: { label: 'No source', tone: 'warning', note: 'No data source is mapped, so it is not reported.' },
  DEMO: { label: 'Demo', tone: 'neutral', note: 'Synthetic demo data; not governed as NHMIS data.' },
};

/**
 * Indicator configuration.
 *
 * DHIS2 mappings and activation are edited here; targets in the panel beneath.
 * Each indicator shows its NHMIS provenance from the last synchronisation:
 * only verified indicators are reported, and an unverified one lists the
 * operand that kept it out. Scoring rules and quality bounds are shown but not
 * editable: changing how a value becomes a score is a methodology decision.
 */
export function IndicatorEditor({
  indicators,
  provenance,
  domains,
  canManage,
  globalScope,
  areas,
  periods,
  mode,
}: {
  indicators: IndicatorDefinition[];
  provenance: Record<string, IndicatorProvenance & { checkedAt: string }>;
  domains: Array<{ id: string; name: string }>;
  canManage: boolean;
  globalScope: boolean;
  areas: Array<{ id: string; name: string; level: OrgLevel }>;
  periods: Array<{ id: string; label: string; type: PeriodType }>;
  mode: DataMode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<IndicatorDefinition | null>(null);
  const [dx, setDx] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domainName = new Map(domains.map((domain) => [domain.id, domain.name]));

  function open(indicator: IndicatorDefinition) {
    setSelected(indicator);
    setDx(indicator.source.dx ?? '');
    setError(null);
  }

  async function save(changes: Record<string, unknown>) {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/indicators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, ...changes }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'The change could not be saved.');
        return;
      }
      setSelected(null);
      router.refresh();
    } catch {
      setError('We could not reach the server. Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  const detail = selected ? provenance[selected.id] : undefined;
  const reportable = detail ? ['VERIFIED', 'APPROVED_EXCEPTION', 'DEMO'].includes(detail.status) && selected!.active : false;

  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <Th width="30%">Indicator</Th>
            <Th width="15%">Domain</Th>
            <Th align="right" width="9%">
              Default target
            </Th>
            <Th width="15%">DHIS2 mapping</Th>
            <Th width="15%">NHMIS provenance</Th>
            <Th width="9%">Status</Th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((indicator) => {
            const status = provenance[indicator.id]?.status;
            return (
              <Tr key={indicator.id} interactive>
                <Td>
                  <button
                    type="button"
                    onClick={() => open(indicator)}
                    className="text-left font-medium hover:text-[var(--brand-600)] hover:underline"
                  >
                    {indicator.name}
                  </button>
                  <span className="mt-0.5 block font-mono text-[10px] text-[var(--text-tertiary)]">{indicator.id}</span>
                </Td>
                <Td className="text-[12px] text-[var(--text-secondary)]">{domainName.get(indicator.domainId) ?? indicator.domainId}</Td>
                <Td align="right" numeric>
                  {indicator.unit === 'COUNT' ? (
                    <span className="text-[11px] text-[var(--text-tertiary)]" title="Count targets are set per area.">
                      per area
                    </span>
                  ) : (
                    <>
                      {indicator.defaultTarget}
                      {indicator.unit === 'PERCENT' ? '%' : ''}
                    </>
                  )}
                </Td>
                <Td>
                  {mappingLabel(indicator) ? (
                    <span className="break-all font-mono text-[11px]">{mappingLabel(indicator)}</span>
                  ) : (
                    <Badge tone="warning">Not mapped</Badge>
                  )}
                </Td>
                <Td>
                  {status ? (
                    <Badge tone={PROVENANCE_META[status].tone} title={PROVENANCE_META[status].note}>
                      {PROVENANCE_META[status].label}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" title="Checked at the next synchronisation.">
                      Not yet checked
                    </Badge>
                  )}
                </Td>
                <Td>
                  <Badge tone={indicator.active ? 'positive' : 'neutral'}>{indicator.active ? 'Active' : 'Inactive'}</Badge>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
      {mode === 'DHIS2' ? (
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Provenance is checked at every synchronisation against the data elements DHIS2 records on the approved NHMIS
          forms. Only verified indicators are synchronised, scored, reported or open to target setting.
        </p>
      ) : null}

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        description={selected?.id}
        width="lg"
        footer={
          selected && canManage ? (
            <div className="space-y-2">
              {error ? (
                <p role="alert" className="text-[12px] text-[var(--concern-600)]">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" disabled={pending} onClick={() => void save({ dx: dx.trim() })}>
                  Save mapping
                </Button>
                <Button size="sm" disabled={pending} onClick={() => void save({ active: !selected.active })}>
                  {selected.active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-tertiary)]">Editing indicator configuration requires administrator access.</p>
          )
        }
      >
        {selected ? (
          <div className="space-y-6">
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{selected.description}</p>

            <section aria-labelledby="provenance-heading">
              <div className="flex items-center justify-between gap-2">
                <h3 id="provenance-heading" className="text-[12px] font-semibold">
                  NHMIS provenance
                </h3>
                {detail ? <Badge tone={PROVENANCE_META[detail.status].tone}>{PROVENANCE_META[detail.status].label}</Badge> : null}
              </div>
              {detail ? (
                <div className="mt-2 space-y-2 text-[12px]">
                  <p className="text-[var(--text-secondary)]">
                    {PROVENANCE_META[detail.status].note}
                    {detail.sourceName ? ` Source: ${detail.sourceName}.` : ''} Checked{' '}
                    {new Date(detail.checkedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })}.
                  </p>
                  {detail.reasons.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 text-[var(--concern-700)]">
                      {detail.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  {detail.operands.length > 0 ? (
                    <TableWrap>
                      <thead>
                        <tr>
                          <Th>Operand</Th>
                          <Th>Role</Th>
                          <Th>Verified</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.operands.map((operand) => (
                          <Tr key={`${operand.ref}:${operand.role}`}>
                            <Td className="text-[12px]">
                              {operand.name ?? <span className="text-[var(--text-tertiary)]">Unknown</span>}
                              <span className="block font-mono text-[10px] text-[var(--text-tertiary)]">{operand.ref}</span>
                            </Td>
                            <Td className="text-[12px] text-[var(--text-secondary)]">{operand.role.toLowerCase()}</Td>
                            <Td className="text-[12px]">
                              {operand.verified ? (
                                <span className="text-[var(--positive-700)]">On approved form</span>
                              ) : operand.exception ? (
                                <span className="text-[var(--info-700)]">Exception: {operand.exception}</span>
                              ) : (
                                <span className="text-[var(--concern-700)]">Not verified</span>
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </TableWrap>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">Not checked yet; it is checked at the next synchronisation.</p>
              )}
            </section>

            <section aria-labelledby="targets-heading">
              <h3 id="targets-heading" className="text-[12px] font-semibold">
                Targets
              </h3>
              {reportable ? (
                <TargetsPanel
                  key={selected.id}
                  indicator={selected}
                  canManage={canManage}
                  globalScope={globalScope}
                  areas={areas}
                  periods={periods}
                  onChanged={() => router.refresh()}
                />
              ) : (
                <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
                  Targets can be set once the indicator is active and verified for reporting.
                </p>
              )}
            </section>

            {canManage ? (
              <TextInput
                label="DHIS2 identifier"
                value={dx}
                onChange={(event) => setDx(event.target.value)}
                hint="The indicator or data-element UID queried through the analytics API. Its provenance is re-checked at the next synchronisation. Leave blank to skip this indicator."
              />
            ) : null}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-4 text-[12px]">
              {[
                ['Unit', selected.unit.toLowerCase().replace(/_/g, ' ')],
                ['Frequency', selected.frequency.toLowerCase()],
                ['Lowest level', selected.lowestLevel.toLowerCase()],
                ['Scoring rule', selected.scoring.kind.toLowerCase().replace('_', ' ')],
                ['Reporting form', selected.source.datasetId ?? '—'],
                ['Valid range', `${selected.quality.min ?? '−∞'} to ${selected.quality.max ?? '∞'}`],
                ['Numerator check', selected.quality.numeratorMustNotExceedDenominator ? 'enforced' : 'not applicable'],
                ['Disaggregations', selected.disaggregations.join(', ') || 'none'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
