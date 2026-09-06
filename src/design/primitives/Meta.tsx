import type { ReactNode } from 'react';
import type { EvidenceItem } from '@/core/quality/types';
import { cn } from './cn';
import { Badge } from './Badge';

/**
 * Marks any figure derived from a methodology that is not yet official.
 *
 * The ASPIRE-GAC methodology has not been supplied. Scores computed with the
 * provisional stand-in are labelled everywhere they appear, so no one can mistake
 * a development placeholder for an agreed government measure.
 */
export function ProvisionalBadge({
  version,
  status,
}: {
  version: string;
  status: 'PROVISIONAL' | 'OFFICIAL' | 'RETIRED';
}) {
  if (status === 'OFFICIAL') {
    return (
      <Badge tone="neutral" title={`Scored using methodology ${version}`}>
        {version}
      </Badge>
    );
  }
  return (
    <Badge
      tone="warning"
      icon={<span aria-hidden="true">◆</span>}
      title={`Scored using the provisional methodology ${version}. The official ASPIRE-GAC methodology has not yet been applied.`}
    >
      Provisional methodology
    </Badge>
  );
}

/** The evidence a figure or a finding rests on, shown as label/value pairs. */
export function EvidenceList({ items, className }: { items: EvidenceItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <dl className={cn('grid gap-x-6 gap-y-1.5 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={`${item.label}:${item.value}`} className="flex items-baseline justify-between gap-3">
          <dt className="text-[12px] text-[var(--text-tertiary)]">{item.label}</dt>
          <dd className="numeric text-right text-[12px] font-medium text-[var(--text-primary)]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionHeading({
  children,
  description,
  action,
  className,
}: {
  children: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-4', className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.011em] text-[var(--text-primary)]">
          {children}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-[11px] font-medium text-[var(--text-tertiary)]', className)}>{children}</span>
  );
}
