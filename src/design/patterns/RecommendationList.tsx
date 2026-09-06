'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Recommendation } from '@/core/insight/types';
import { Card, CardBody } from '../primitives/Card';
import { Badge } from '../primitives/Badge';
import { SeverityPill } from '../primitives/StatusPill';
import { EvidenceList } from '../primitives/Meta';
import { EmptyState } from '../primitives/States';
import { Button } from '../primitives/Button';
import { Drawer } from '../primitives/Drawer';

/**
 * Recommendations, and the one gesture that follows them.
 *
 * The list exists to be acted on, so raising a follow-up action is available
 * from the recommendation itself and carries its evidence across. Users without
 * permission to manage actions see the recommendation without the control.
 */
export function RecommendationList({
  recommendations,
  periodId,
  canManageActions = false,
}: {
  recommendations: Recommendation[];
  periodId: string;
  canManageActions?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (recommendations.length === 0) {
    return (
      <Card>
        <CardBody className="pt-5">
          <EmptyState
            title="No recommendations for this period."
            description="Recommendations are only produced where the platform can name the geography, the indicators and the figures behind them. Nothing in scope currently meets that bar."
          />
        </CardBody>
      </Card>
    );
  }

  async function createAction(recommendation: Recommendation) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: recommendation.title,
          detail: `${recommendation.issue}\n\nRecommended: ${recommendation.nextStep}`,
          orgUnitId: recommendation.orgUnitId,
          indicatorId: recommendation.indicatorIds[0] ?? null,
          periodId,
          source: 'RECOMMENDATION',
          sourceRef: recommendation.id,
          priority: recommendation.priority,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'The action could not be created.');
        return;
      }
      setCreated(recommendation.id);
      router.refresh();
    } catch {
      setError('We could not reach the server. Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {recommendations.map((recommendation) => (
          <Card key={recommendation.id} className="flex flex-col p-4">
            <div className="mb-2 flex items-center gap-2">
              <SeverityPill severity={recommendation.priority} />
              <Badge tone="neutral" title="How strongly the evidence supports this recommendation">
                {Math.round(recommendation.confidence * 100)}% confidence
              </Badge>
            </div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              {recommendation.title}
            </h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {recommendation.issue}
            </p>
            <div className="mt-auto flex items-center gap-2 pt-3">
              <Button size="sm" onClick={() => setSelected(recommendation)}>
                View evidence
              </Button>
              {canManageActions ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || created === recommendation.id}
                  onClick={() => createAction(recommendation)}
                >
                  {created === recommendation.id ? 'Action raised' : 'Raise action'}
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-[var(--concern-600)]">
          {error}
        </p>
      ) : null}

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ''}
        description={selected?.location}
        width="lg"
      >
        {selected ? (
          <div className="space-y-5">
            <section>
              <h3 className="mb-1 text-[12px] font-semibold">Issue</h3>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{selected.issue}</p>
            </section>
            <section>
              <h3 className="mb-2 text-[12px] font-semibold">Evidence</h3>
              <EvidenceList items={selected.evidence} className="sm:grid-cols-1" />
            </section>
            <section>
              <h3 className="mb-1 text-[12px] font-semibold">Most likely driver</h3>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {selected.likelyDriver}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                Stated as a hypothesis. The platform can see what moved, not why it moved.
              </p>
            </section>
            <section>
              <h3 className="mb-1 text-[12px] font-semibold">Recommended next step</h3>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {selected.nextStep}
              </p>
            </section>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
