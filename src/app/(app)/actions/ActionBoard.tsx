'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ActionView } from '@/services/actions';
import type { ActionStatus } from '@/data/repositories/actions';
import { Card } from '@/design/primitives/Card';
import { Badge } from '@/design/primitives/Badge';
import { SeverityPill } from '@/design/primitives/StatusPill';
import { Button } from '@/design/primitives/Button';
import { Drawer } from '@/design/primitives/Drawer';
import { Select } from '@/design/primitives/Field';
import { EmptyState } from '@/design/primitives/States';

/**
 * The follow-up loop, kept deliberately small:
 * insight → investigate → act → resolve → measure.
 *
 * There are five states and one owner. Anything more would be a
 * project-management tool competing with whatever the organisation already uses.
 */
const FLOW: Array<{ status: ActionStatus; label: string; hint: string }> = [
  { status: 'OPEN', label: 'Open', hint: 'Raised, not yet picked up' },
  { status: 'INVESTIGATING', label: 'Investigating', hint: 'Someone is establishing what is happening' },
  { status: 'IN_PROGRESS', label: 'Acting', hint: 'A response is under way' },
  { status: 'RESOLVED', label: 'Resolved', hint: 'Done — outcome recorded' },
  { status: 'CLOSED', label: 'Closed', hint: 'No further action needed' },
];

export function ActionBoard({
  actions,
  canManage,
  assignees,
}: {
  actions: ActionView[];
  canManage: boolean;
  assignees: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ActionView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');

  async function patch(id: string, changes: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/actions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...changes }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'The action could not be updated.');
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

  if (actions.length === 0) {
    return (
      <EmptyState
        title="No follow-up actions yet."
        description="Actions are raised from a recommendation on the Overview, or from a data-quality finding. They keep the loop from an insight to a measured outcome in one place."
        action={
          <Link href="/overview" className="text-[12px] text-[var(--brand-600)] hover:underline">
            Go to Overview →
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-5">
        {FLOW.map((column) => {
          const columnActions = actions.filter((action) => action.status === column.status);
          return (
            <section key={column.status} aria-label={column.label}>
              <header className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">{column.label}</h2>
                <span className="numeric text-[11px] text-[var(--text-tertiary)]">
                  {columnActions.length}
                </span>
              </header>
              <p className="mb-2 text-[11px] leading-snug text-[var(--text-tertiary)]">{column.hint}</p>
              <div className="space-y-2">
                {columnActions.map((action) => (
                  <Card key={action.id} className="p-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(action);
                        setOutcome(action.outcome ?? '');
                      }}
                      className="w-full text-left"
                    >
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <SeverityPill severity={action.priority} />
                      </div>
                      <p className="text-[12px] leading-snug font-medium text-[var(--text-primary)]">
                        {action.title}
                      </p>
                      {action.orgUnitName ? (
                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{action.orgUnitName}</p>
                      ) : null}
                      {action.assigneeName ? (
                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                          {action.assigneeName}
                        </p>
                      ) : null}
                    </button>
                  </Card>
                ))}
                {columnActions.length === 0 ? (
                  <p className="rounded-[var(--radius-md)] border border-dashed px-3 py-4 text-center text-[11px] text-[var(--text-tertiary)]">
                    Nothing here
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ''}
        description={selected?.orgUnitName ?? undefined}
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
                {FLOW.filter((column) => column.status !== selected.status).map((column) => (
                  <Button
                    key={column.status}
                    size="sm"
                    variant={column.status === 'RESOLVED' ? 'primary' : 'secondary'}
                    disabled={pending}
                    onClick={() =>
                      void patch(selected.id, {
                        status: column.status,
                        ...(column.status === 'RESOLVED' || column.status === 'CLOSED'
                          ? { outcome: outcome.trim() || null }
                          : {}),
                      })
                    }
                  >
                    Move to {column.label.toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityPill severity={selected.priority} />
              <Badge tone="neutral">{selected.status.toLowerCase().replace('_', ' ')}</Badge>
              <Badge tone="neutral">Raised from {selected.source.toLowerCase()}</Badge>
            </div>

            <p className="text-[13px] leading-relaxed whitespace-pre-line text-[var(--text-secondary)]">
              {selected.detail}
            </p>

            {selected.scoreSinceRaised ? (
              <section className="rounded-[var(--radius-md)] border bg-[var(--surface-sunken)] px-3 py-2.5">
                <h3 className="mb-1 text-[12px] font-semibold">Outcome so far</h3>
                <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  The overall score for {selected.orgUnitName} was{' '}
                  <span className="numeric font-medium">{selected.scoreSinceRaised.baseline}</span> when this
                  was raised and is now{' '}
                  <span className="numeric font-medium">{selected.scoreSinceRaised.current}</span> — a change
                  of{' '}
                  <span
                    className={
                      selected.scoreSinceRaised.change >= 0
                        ? 'text-[var(--positive-600)]'
                        : 'text-[var(--concern-600)]'
                    }
                  >
                    {selected.scoreSinceRaised.change > 0 ? '+' : ''}
                    {selected.scoreSinceRaised.change} points
                  </span>
                  .
                </p>
              </section>
            ) : null}

            {canManage ? (
              <div className="space-y-3 border-t pt-4">
                <Select
                  label="Assigned to"
                  value={selected.assigneeId ?? ''}
                  disabled={pending}
                  onChange={(event) =>
                    void patch(selected.id, { assigneeId: event.target.value || null })
                  }
                >
                  <option value="">Unassigned</option>
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.name}
                    </option>
                  ))}
                </Select>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="action-outcome"
                    className="text-[11px] font-medium text-[var(--text-tertiary)]"
                  >
                    Outcome
                  </label>
                  <textarea
                    id="action-outcome"
                    value={outcome}
                    onChange={(event) => setOutcome(event.target.value)}
                    rows={3}
                    placeholder="What was found, and what was done about it."
                    className="rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 py-2 text-[13px]"
                  />
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    Recorded when the action is moved to resolved or closed.
                  </p>
                </div>
              </div>
            ) : selected.outcome ? (
              <section className="border-t pt-4">
                <h3 className="mb-1 text-[12px] font-semibold">Outcome</h3>
                <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{selected.outcome}</p>
              </section>
            ) : null}

            <p className="border-t pt-3 text-[11px] text-[var(--text-tertiary)]">
              Raised by {selected.createdByName ?? 'unknown'} on{' '}
              {new Date(selected.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
              {selected.periodId ? ` against ${selected.periodId}` : ''}.
            </p>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
