'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IndicatorDefinition } from '@/core/registry/types';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { Badge } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Drawer } from '@/design/primitives/Drawer';
import { TextInput } from '@/design/primitives/Field';

/**
 * Indicator configuration.
 *
 * Targets, DHIS2 mappings and activation are edited here rather than in code,
 * which is what makes the registry configuration. Scoring rules and quality
 * bounds are shown but not editable from the interface: changing how a value
 * becomes a score is a methodology decision, and belongs with the methodology
 * record rather than with a per-indicator form.
 */
export function IndicatorEditor({
  indicators,
  canManage,
}: {
  indicators: IndicatorDefinition[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<IndicatorDefinition | null>(null);
  const [target, setTarget] = useState('');
  const [dx, setDx] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(indicator: IndicatorDefinition) {
    setSelected(indicator);
    setTarget(String(indicator.defaultTarget));
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

  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <Th width="30%">Indicator</Th>
            <Th width="16%">Domain</Th>
            <Th align="right" width="9%">
              Target
            </Th>
            <Th width="12%">Direction</Th>
            <Th width="15%">DHIS2 mapping</Th>
            <Th width="10%">Status</Th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((indicator) => (
            <Tr key={indicator.id} interactive>
              <Td>
                <button
                  type="button"
                  onClick={() => open(indicator)}
                  className="text-left font-medium hover:text-[var(--brand-600)] hover:underline"
                >
                  {indicator.name}
                </button>
                <span className="mt-0.5 block font-mono text-[10px] text-[var(--text-tertiary)]">
                  {indicator.id}
                </span>
              </Td>
              <Td className="text-[12px] text-[var(--text-secondary)]">{indicator.domainId}</Td>
              <Td align="right" numeric>
                {indicator.defaultTarget}
                {indicator.unit === 'PERCENT' ? '%' : ''}
              </Td>
              <Td className="text-[12px] text-[var(--text-tertiary)]">
                {indicator.directionality === 'HIGHER_IS_BETTER' ? 'Higher is better' : 'Lower is better'}
              </Td>
              <Td>
                {indicator.source.dx ? (
                  <span className="font-mono text-[11px]">{indicator.source.dx}</span>
                ) : (
                  <Badge tone="warning">Not mapped</Badge>
                )}
              </Td>
              <Td>
                <Badge tone={indicator.active ? 'positive' : 'neutral'}>
                  {indicator.active ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>

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
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    void save({
                      defaultTarget: Number(target),
                      dx: dx.trim(),
                    })
                  }
                >
                  Save changes
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void save({ active: !selected.active })}
                >
                  {selected.active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Editing indicator configuration requires administrator access.
            </p>
          )
        }
      >
        {selected ? (
          <div className="space-y-5">
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {selected.description}
            </p>

            {canManage ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  label="Default target"
                  type="number"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  hint="Applies where no geography- or period-specific target is set."
                />
                <TextInput
                  label="DHIS2 identifier"
                  value={dx}
                  onChange={(event) => setDx(event.target.value)}
                  hint="The indicator or data-element UID queried through the analytics API. Leave blank to skip this indicator during synchronisation."
                />
              </div>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-4 text-[12px]">
              {[
                ['Unit', selected.unit.toLowerCase().replace(/_/g, ' ')],
                ['Frequency', selected.frequency.toLowerCase()],
                ['Lowest level', selected.lowestLevel.toLowerCase()],
                ['Scoring rule', selected.scoring.kind.toLowerCase().replace('_', ' ')],
                ['Dataset', selected.source.datasetId ?? '—'],
                [
                  'Valid range',
                  `${selected.quality.min ?? '−∞'} to ${selected.quality.max ?? '∞'}`,
                ],
                [
                  'Numerator check',
                  selected.quality.numeratorMustNotExceedDenominator ? 'enforced' : 'not applicable',
                ],
                ['Disaggregations', selected.disaggregations.join(', ') || 'none'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Scoring rules and validity bounds are part of the methodology record rather than a per-indicator
              setting, so that a change to how values become scores is versioned and traceable.
            </p>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
